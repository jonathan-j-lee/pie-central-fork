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

description = 'PiE robot daemon'

setup(
    name='runtime',
    version='0.9.0',
    description=description,
    long_description=description,
    author='PiE runtime team',
    author_email='runtime@pioneers.berkeley.edu',
    python_requires='>=3.9',
    url='https://github.com/jonathan-j-lee/pie-central-fork',
    packages=['runtime'],
    install_requires=[
        'cbor2>=5,<6',
        'click>=8,<9',
        'colorama<1',
        'orjson>=3,<4',
        'pylint>=2,<3',
        'pyserial-asyncio<1',
        'pyudev<1',
        'pyzmq>=22,<23',
        'structlog>=21,<22',
        'uvloop<1',
        'PyYAML>=5,<6',
    ],
    classifiers=[
        'Development Status :: 3 - Alpha',
        'Natural Language :: English',
        'Operating System :: POSIX :: Linux',
        'Programming Language :: Cython',
        'Programming Language :: Python :: 3.9',
    ],
    ext_modules=cythonize(
        extensions,
        language_level=3,
        nthreads=4,
        compiler_directives=directives,
    ),
    package_data={
        'runtime': ['py.typed'],
    },
)
