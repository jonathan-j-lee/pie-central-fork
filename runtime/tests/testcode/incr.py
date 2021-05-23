import collections

counters = collections.defaultdict(lambda: 0)


def challenge(x: int) -> int:
    return x + 1


def bad():
    raise OSError


def autonomous_setup():
    counters['autonomous_setup'] += 1


def autonomous_main():
    counters['autonomous_main'] += 1


def teleop_setup():
    counters['teleop_setup'] += 1


def teleop_main():
    counters['teleop_main'] += 1
