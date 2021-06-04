import os
from setuptools import setup, Extension
from Cython.Build import cythonize


trace = bool(os.environ.get('RT_TRACE'))
directives = {
    'linetrace': trace,
}
define_macros = []
if trace:
    define_macros.append(('CYTHON_TRACE_NOGIL', '1'))

extensions = [
    Extension(
        'runtime.sync',
        ['runtime/sync.pyx'],
        define_macros=define_macros,
    ),
    Extension(
        'runtime.messaging',
        ['runtime/messaging.pyx'],
        include_dirs=['../smart-devices/SmartDevice/src'],
        extra_objects=['../smart-devices/cobs-c/cobs.o'],
        define_macros=define_macros,
    ),
]

setup(
    name='runtime',
    ext_modules=cythonize(
        extensions,
        language_level=3,
        nthreads=4,
        compiler_directives=directives,
    ),
)
