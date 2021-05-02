from posix.time cimport timespec

cdef extern from "<pthread.h>" nogil:
    ctypedef struct pthread_mutex_t:
        pass
    ctypedef struct pthread_mutexattr_t:
        pass
    cdef enum:
        PTHREAD_PRIO_INHERIT,
        PTHREAD_PROCESS_PRIVATE,
        PTHREAD_PROCESS_SHARED,
        PTHREAD_MUTEX_ERRORCHECK
    int pthread_mutex_init(pthread_mutex_t *, const pthread_mutexattr_t *)
    int pthread_mutex_destroy(pthread_mutex_t *)
    int pthread_mutex_lock(pthread_mutex_t *)
    int pthread_mutex_trylock(pthread_mutex_t *)
    int pthread_mutex_timedlock(pthread_mutex_t *, const timespec *)
    int pthread_mutex_unlock(pthread_mutex_t *)
    int pthread_mutexattr_init(pthread_mutexattr_t *)
    int pthread_mutexattr_destroy(pthread_mutexattr_t *)
    int pthread_mutexattr_setpshared(pthread_mutexattr_t *, int)
    int pthread_mutexattr_settype(pthread_mutexattr_t *, int)
    int pthread_mutexattr_setprotocol(pthread_mutexattr_t *, int)
