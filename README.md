# pie-central-fork

[![pie-central](https://github.com/jonathan-j-lee/pie-central-fork/actions/workflows/ci.yml/badge.svg)](https://github.com/jonathan-j-lee/pie-central-fork/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/jonathan-j-lee/pie-central-fork/branch/master/graph/badge.svg?token=VGDWDH8ZBI)](https://codecov.io/gh/jonathan-j-lee/pie-central-fork)
[![Code style: black](https://img.shields.io/badge/code%20style-black-000000.svg)](https://github.com/psf/black)
[![docs: github pages](https://img.shields.io/badge/docs-gh%20pages-informational.svg)](https://jonathan-j-lee.github.io/pie-central-fork/)

The PiE robotics kit is a platform for building and operating a robot programmed in Python.
Designed to [give high school students hands-on engineering experience](https://pioneers.berkeley.edu/), the kit allows users to control sensors and actuators through a high-level API without deep technical expertise.

The kit consists of several components:

* [Runtime](runtime), a daemon running on each robot's Raspberry Pi that executes student code and sends commands to Arduino-based sensors.
* The [Smart Devices library](smart-devices), which implements a duplex binary messaging protocol for controlling sensors.
  The library also includes Arduino sketches for each particular device type as well as Python bindings.
* [Dawn](dawn), an Electron app frontend that combines a text editor with a control system for operating a robot.
* Shepherd, a web app for running matches and managing the field during a competition.

Please see the [documentation](runtime/docs/source) for a discussion of the architecture.

:warning: This is an ongoing personal project that substantially rewrites [the previous iteration of the kit](https://github.com/pioneers/PieCentral).

## Gallery

Here is an early look at the kit:

Runtime logging the state of a switch to Dawn:

https://user-images.githubusercontent.com/16431277/133330821-094d6466-8afe-45bc-9f61-f9953bc3c0ad.mp4

Running a match in Shepherd:

https://user-images.githubusercontent.com/16431277/133330823-89109553-db58-4d23-bfb4-202277847cde.mp4
