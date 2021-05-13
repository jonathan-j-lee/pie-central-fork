# distutils: language=c++

import contextlib
import math
import time
from numbers import Real
from typing import Optional

from libcpp cimport bool

from .exception import RuntimeBaseException

__all__ = ['SyncError', 'Mutex']


class SyncError(RuntimeBaseException):
    def __init__(self, message: str, errno: int, **context):
        super().__init__(message, **context, errno=errno)

    def suppress(*errnos: int):
        try:
            yield
        except SyncError as exc:
            if exc.context['errno'] not in errnos:
                raise
    suppress = staticmethod(contextlib.contextmanager(suppress))


cdef class Mutex:
    cdef pthread_mutex_t *mutex
    cdef pthread_mutexattr_t *attrs
    cdef pthread_mutex_t local_mutex
    cdef pthread_mutexattr_t local_attrs
    cdef bool shared

    SIZE = sizeof(pthread_mutex_t) + sizeof(pthread_mutexattr_t)

    def __cinit__(self, unsigned char[::1] buf = None, shared: bool = True):
        if buf is None:
            self.mutex = &self.local_mutex
            self.attrs = &self.local_attrs
            self.shared = False
        else:
            if buf.shape[0] < self.SIZE:
                raise ValueError('buffer is too small to fit Mutex')
            self.mutex = <pthread_mutex_t *> &buf[0]
            self.attrs = <pthread_mutexattr_t *> &buf[sizeof(pthread_mutex_t)]
            self.shared = shared

    def __enter__(self):
        self.acquire()

    def __exit__(self, _exc_type, _exc, _traceback):
        self.release()

    def initialize(self):
        pthread_mutexattr_init(self.attrs)
        pthread_mutexattr_setprotocol(self.attrs, PTHREAD_PRIO_INHERIT)
        shared = PTHREAD_PROCESS_SHARED if self.shared else PTHREAD_PROCESS_PRIVATE
        pthread_mutexattr_setpshared(self.attrs, shared)
        pthread_mutexattr_settype(self.attrs, PTHREAD_MUTEX_ERRORCHECK)
        pthread_mutex_init(self.mutex, self.attrs)

    def destroy(self):
        pthread_mutex_destroy(self.mutex)
        pthread_mutexattr_destroy(self.attrs)

    def acquire(self, timeout: Optional[Real] = 5):
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
