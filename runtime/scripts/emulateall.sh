#!/bin/bash

pipenv run emulate $(python -c "for dev_id in [0, 1, 2, 3, 4, 5, 7, 10, 11, 12, 13]: print(dev_id << 72)")
