# distutils: language=c++

"""Synchronization primitives using ``pthread`` bindings.

Unlike the primitives available in :mod:`threading` and :mod:`multiprocessing`, this
module's primitives can be created from any buffer, including shared memory, and do not
need to be passed through :class:`multiprocessing.Process` to be shared. This module is
intended for consumption by :mod:`runtime.buffer`.

References:
    ``pthreads`` documentation:
        https://pubs.opengroup.org/onlinepubs/009695399/basedefs/pthread.h.html
"""

import contextlib
import math
import time
from numbers import Real

from libcpp cimport bool

from .exception import RuntimeBaseException

# isort: unique-list
__all__ = ['Mutex', 'SyncError']


class SyncError(RuntimeBaseException):
    """Synchronization error.

    Parameters:
        errno (int): A standard error symbol returned by ``pthread`` (see :mod:`errno`
            for the list).
    """

    def __init__(self, message, errno, **context):
        super().__init__(message, **context, errno=errno)

    def suppress(*errnos):
        """Suppress a synchronization error.

        Parameters:
            errnos (int): A list of error numbers to ignore.

        Returns:
            ContextManager[None]: A context manager suppressing a ``SyncError``.
        """
        try:
            yield
        except SyncError as exc:
            if exc.context['errno'] not in errnos:
                raise
    suppress = staticmethod(contextlib.contextmanager(suppress))


cdef class Mutex:
    """Mutex(buf, /, *, shared: bool = True, recursive: bool = True)

    A mutex to enforce mutual exclusion among OS threads.

    This mutex supports the context manager protocol to acquire and release
    automatically. This usage is preferred over manually calling :meth:`acquire` and
    :meth:`release`, since failing to release the mutex can starve its waiters. Entering
    the context uses the default acquisition strategy, which is a timed lock.

    Parameters:
        buf: An optional writeable buffer backing this mutex. Must be at least
            :attr:`Mutex.SIZE` bytes large. Any extra bytes after the first
            :attr:`Mutex.SIZE` will remain unused. If not provided, this mutex will use
            statically allocated memory that cannot be shared.
        shared (bool): Whether this mutex is to be shared among processes.
        recursive (bool): Whether this mutex may be successfully reacquired. Every
            acquisition increments an internal counter, which is decremented by every
            release. The mutex is only released once the counter reaches zero.
            Attempting to re-acquire a nonrecursive mutex will raise a :exc:`SyncError`
            with :data:`errno.EDEADLK` as the error code. Attempting to re-release an
            unlocked mutex will also raise a :exc:`SyncError` with :data:`errno.EPERM`
            as the error code.

    Attributes:
        SIZE (Final[int]): The size of a mutex (in bytes).
    """
    cdef pthread_mutex_t *mutex
    cdef pthread_mutexattr_t *attrs
    cdef pthread_mutex_t local_mutex
    cdef pthread_mutexattr_t local_attrs
    cdef int pshared
    cdef int type

    SIZE = sizeof(pthread_mutex_t) + sizeof(pthread_mutexattr_t)

    def __cinit__(
        self,
        unsigned char[::1] buf = None,
        /,
        *,
        shared = True,
        recursive = True,
    ):
        if buf is None:
            self.mutex = &self.local_mutex
            self.attrs = &self.local_attrs
            shared = False
        else:
            if buf.shape[0] < self.SIZE:
                raise ValueError('buffer is too small to fit Mutex')
            self.mutex = <pthread_mutex_t *> &buf[0]
            self.attrs = <pthread_mutexattr_t *> &buf[sizeof(pthread_mutex_t)]
        self.pshared = PTHREAD_PROCESS_SHARED if shared else PTHREAD_PROCESS_PRIVATE
        self.type = PTHREAD_MUTEX_RECURSIVE if recursive else PTHREAD_MUTEX_ERRORCHECK

    def __enter__(self, /):
        self.acquire()

    def __exit__(self, _exc_type, _exc, _traceback, /):
        self.release()

    def initialize(self, /):
        """Initialize the mutex.

        The mutex is not usuable until :meth:`initialize` is called. Only initialize
        this mutex once across all waiters. Initializing the mutex multiple times
        without calling :meth:`destroy` is undefined behavior.
        """
        pthread_mutexattr_init(self.attrs)
        pthread_mutexattr_setprotocol(self.attrs, PTHREAD_PRIO_INHERIT)
        pthread_mutexattr_setpshared(self.attrs, self.pshared)
        pthread_mutexattr_settype(self.attrs, self.type)
        pthread_mutex_init(self.mutex, self.attrs)

    def destroy(self, /):
        """Destroy the mutex.

        After calling this method, the mutex becomes unusable until :meth:`initialize`
        is called again.
        """
        pthread_mutex_destroy(self.mutex)
        pthread_mutexattr_destroy(self.attrs)

    def acquire(self, /, *, timeout=1):
        """Attempt to acquire the mutex.

        This method selects an acquisition strategy from the value of ``timeout``:

        1. When ``timeout=None``, this method will acquire the mutex with no timeout.
           Because this strategy can block indefinitely and starve the waiter, it is not
           recommended.
        2. When ``timeout=0``, this method will attempt to acquire the mutex using
           `try-lock`_.
        3. When ``timeout > 0``, this method performs a `timed lock`_.

        Parameters:
            timeout (Optional[float]): Maximum duration (in seconds) to wait to acquire
                the mutex.

        Raises:
            ValueError: If the timeout is strictly negative.
            SyncError: If the mutex acquisition fails.

        .. _try-lock:
            https://pubs.opengroup.org/onlinepubs/009695399/functions/pthread_mutex_lock.html
        .. _timed lock:
            https://pubs.opengroup.org/onlinepubs/009695399/functions/pthread_mutex_timedlock.html
        """
        cdef timespec duration
        cdef int status
        if isinstance(timeout, Real):
            if timeout < 0:
                raise ValueError('timeout must be a positive real number')
            elif timeout == 0:
                status = pthread_mutex_trylock(self.mutex)
            else:
                fractional, whole = math.modf(time.time() + timeout)
                duration.tv_sec = int(whole)
                duration.tv_nsec = int(fractional*10**9)
                status = pthread_mutex_timedlock(self.mutex, &duration)
        else:
            status = pthread_mutex_lock(self.mutex)
        if status != 0:
            raise SyncError('failed to acquire mutex', status)

    def release(self, /):
        """Attempt to release the mutex.

        Raises:
            SyncError: If the mutex release fails.
        """
        cdef int status = pthread_mutex_unlock(self.mutex)
        if status != 0:
            raise SyncError('failed to release mutex', status)
