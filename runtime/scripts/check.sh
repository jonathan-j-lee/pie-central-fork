#!/bin/sh

pipenv run format
pipenv run lint
pipenv run typecheck
pipenv run test
