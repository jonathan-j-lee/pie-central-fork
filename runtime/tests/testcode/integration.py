import time

LIMIT_SWITCH = 0x0_00_00000000_00000001
LEFT_MOTOR = 0xc_00_00000000_00000000
RIGHT_MOTOR = 0xc_00_00000000_00000001

READ_PERIOD = WRITE_PERIOD = 0.05


def fib(n: int) -> int:
    a, b = 0, 1
    for _ in range(n):
        a, b = b, a + b
    return a


def read_limit_switch(duration: float) -> list[bool]:
    readings = []
    start = Field.clock()
    stop = start + duration
    while Field.clock() < stop:
        time.sleep(READ_PERIOD)
        readings.append(Robot.get(LIMIT_SWITCH, 'switch0'))
    return readings


async def sweep_motors():
    duration = 2
    steps = int(duration / WRITE_PERIOD)
    for i in range(0, steps):
        print(f'auto: write {i}')
        Robot.write(LEFT_MOTOR, 'duty_cycle', i/steps)
        Robot.write(RIGHT_MOTOR, 'duty_cycle', -i/steps)
        await Actions.sleep(WRITE_PERIOD)


def autonomous_setup():
    Actions.run(sweep_motors)


def autonomous_main():
    print('auto_main')


def teleop_main():
    print('teleop_main')
    Robot.write(LEFT_MOTOR, 'duty_cycle', Gamepad.get('joystick_left_y'))
    Robot.write(RIGHT_MOTOR, 'duty_cycle', Gamepad.get('joystick_right_y'))
    if Gamepad.get('button_a'):
        Robot.write(LEFT_MOTOR, 'deadband', 0.1)
