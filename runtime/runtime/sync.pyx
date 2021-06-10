# distutils: language=c++

import contextlib
import errno
import math
import time
from numbers import Real
from typing import Optional

from libcpp cimport bool

from .exception import RuntimeBaseException

__all__ = ['SyncError', 'Mutex']


class SyncError(RuntimeBaseException):
    def __init__(self, message, errno, **context):
        super().__init__(message, **context, errno=errno)

    def suppress(*errnos):
        try:
            yield
        except SyncError as exc:
            if exc.context['errno'] not in errnos:
                raise
    suppress = staticmethod(contextlib.contextmanager(suppress))


cdef class Mutex:
    """A mutex.

    If initialized with ``recursive=True``, the mutex can be successfully reacquired.

    Otherwise, re-acquiring will raise a :class:``SyncError`` with :attr:``errno.EDEADLK``.
    Re-releasing will raise a :class:``SyncError`` with :attr:``errno.EPERM``.
    """
    cdef pthread_mutex_t *mutex
    cdef pthread_mutexattr_t *attrs
    cdef pthread_mutex_t local_mutex
    cdef pthread_mutexattr_t local_attrs
    cdef int pshared
    cdef int type

    SIZE = sizeof(pthread_mutex_t) + sizeof(pthread_mutexattr_t)
    DEFAULT_TIMEOUT = 1

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

    def __enter__(self):
        self.acquire(self.DEFAULT_TIMEOUT)

    def __exit__(self, _exc_type, _exc, _traceback):
        self.release()

    def initialize(self):
        pthread_mutexattr_init(self.attrs)
        pthread_mutexattr_setprotocol(self.attrs, PTHREAD_PRIO_INHERIT)
        pthread_mutexattr_setpshared(self.attrs, self.pshared)
        pthread_mutexattr_settype(self.attrs, self.type)
        pthread_mutex_init(self.mutex, self.attrs)

    def destroy(self):
        pthread_mutex_destroy(self.mutex)
        pthread_mutexattr_destroy(self.attrs)

    def acquire(self, timeout=5):
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

    def release(self):
        cdef int status = pthread_mutex_unlock(self.mutex)
        if status != 0:
            raise SyncError('failed to release mutex', status)
