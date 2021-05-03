import ctypes
import errno
import multiprocessing
from multiprocessing.shared_memory import SharedMemory
import time
import pytest
from runtime.sync import SyncError, Mutex


@pytest.fixture
def mutex():
    mutex = Mutex(shared=False)
    mutex.initialize()
    yield mutex
    mutex.destroy()


@pytest.fixture
def shared_mutex():
    shm = SharedMemory('mutex', create=True, size=Mutex.SIZE)
    mutex = Mutex(shm.buf)
    mutex.initialize()
    yield mutex
    mutex.destroy()
    shm.close()
    shm.unlink()


@pytest.fixture
def locking_peer(shared_mutex):
    acquired, done = multiprocessing.Event(), multiprocessing.Event()
    def target(acquired, done):
        shm = SharedMemory('mutex')
        mutex = Mutex(shm.buf)
        with mutex:
            acquired.set()
            done.wait(3)
        shm.close()
    peer = multiprocessing.Process(target=target, args=(acquired, done), daemon=True)
    peer.start()
    acquired.wait(3)
    yield
    done.set()
    peer.join()


def test_try_acquire_release(mutex):
    mutex.acquire(timeout=0)
    mutex.release()


def test_double_acquire(mutex):
    mutex.acquire()
    with pytest.raises(SyncError) as excinfo:
        mutex.acquire()
    assert excinfo.value.context['errno'] == errno.EDEADLK


def test_double_release(mutex):
    mutex.acquire()
    mutex.release()
    with pytest.raises(SyncError) as excinfo:
        mutex.release()
    assert excinfo.value.context['errno'] == errno.EPERM


@pytest.mark.slow
def test_timeout(shared_mutex, locking_peer):
    start = time.time()
    with pytest.raises(SyncError) as excinfo:
        shared_mutex.acquire(timeout=0.5)
    assert time.time() - start == pytest.approx(0.5, rel=0.05)
    assert excinfo.value.context['errno'] == errno.ETIMEDOUT


def test_try_acquire_fail(shared_mutex, locking_peer):
    with pytest.raises(SyncError) as excinfo:
        shared_mutex.acquire(timeout=0)
    assert excinfo.value.context['errno'] == errno.EBUSY


def test_nonowner_release(shared_mutex, locking_peer):
    with pytest.raises(SyncError) as excinfo:
        shared_mutex.release()
    assert excinfo.value.context['errno'] == errno.EPERM


@pytest.mark.slow
def test_contention(shared_mutex):
    increments, process_count, delay = 50, 4, 0.01
    def target(counter, barrier):
        shm = SharedMemory('mutex')
        mutex = Mutex(shm.buf)
        barrier.wait(1)
        for _ in range(increments):
            with mutex:
                value = counter.value
                time.sleep(delay)
                counter.value = value + 1
        barrier.wait(10)
        shm.close()
    counter = multiprocessing.Value(ctypes.c_uint64, lock=False)
    barrier = multiprocessing.Barrier(process_count + 1, action=lambda: barrier.reset())
    children = [multiprocessing.Process(target=target, args=(counter, barrier), daemon=True)
                for _ in range(process_count)]
    for child in children:
        child.start()
    barrier.wait(1)
    barrier.wait(10)
    assert counter.value == increments*process_count
    for child in children:
        child.join()
