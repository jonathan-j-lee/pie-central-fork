#!/bin/bash -ex

pylint runtime
pylint \
  --disable=redefined-outer-name \
  --disable=missing-module-docstring \
  --disable=missing-class-docstring \
  --disable=missing-function-docstring \
  tests/*.py
