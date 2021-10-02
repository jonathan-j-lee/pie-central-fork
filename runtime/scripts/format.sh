#!/bin/bash -ex

isort --profile black $@ runtime stubs tests/*.py
black --color --target-version py39 --skip-string-normalization $@ runtime stubs tests/*.py
