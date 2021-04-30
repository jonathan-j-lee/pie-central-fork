from setuptools import setup, Extension
from Cython.Build import cythonize

extensions = [
    Extension('runtime.messaging', ['runtime/messaging.pyx'],
              include_dirs=['../smart-devices/SmartDevice/src'],
              extra_objects=['../smart-devices/cobs-c/cobs.o']),
]

setup(
    name='runtime',
    ext_modules=cythonize(extensions, language_level=3, nthreads=4),
)
