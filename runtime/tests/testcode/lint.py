LEFT_MOTOR = str(0xfff0_ff_ffffffff_ffffffff)
RIGHT_MOTOR = str(0xfff1_ff_ffffffff_ffffffff)

cycles: int = 0


def autonomous_setup():
    pass


def autonomous_main():
    doesnt_exist += 1


def teleop_setup():
    pass


def teleop_main():
    global cycles
    cycles += 1
    Robot.set_value(LEFT_MOTOR, 'duty_cycle', Gamepad.get_value('joystick_left_y'))
    Robot.set_value(RIGHT_MOTOR, 'duty_cycle', Gamepad.get_value('joystick_right_y'))
