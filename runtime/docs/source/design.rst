Design Goals
============

Context
-------

`Pioneers in Engineering (PiE) <https://pioneers.berkeley.edu/>`_ is a nonprofit run by students of the University of California, Berkeley to promote STEM education.
PiE's primary outreach is a twelve-week robotics competition among about 20 Bay Area high schools every spring.
The competition is analogous to `FRC <https://www.firstinspires.org/robotics/frc>`_ or `VEX <https://www.vexrobotics.com/v5/competition>`_, but with a much lower barrier to entry (both financially and technically) and stronger support and mentorship.

During the PiE robotics season, each high school's team designs and builds a robot to accomplish the objectives of that season's game.
Each team is comprised of five to ten high school students, at least one high school teacher sponsor, and one or two mentors who are UC Berkeley students.
Each team also receives a base kit developed by PiE staff that assembles into a minimal four-wheeled robot.
Teams gradually extend their base robots with parts "purchased" from PiE with a mock currency.

The "brain" of each robot is a Raspberry Pi running Linux that controls up to about 10 `Smart Devices <smart-devices.html>`_.
Using an API PiE provides, students write and upload Python code to the Pi to control the robot.
Runtime is the application running on the Pi to manage the Smart Devices, execute the student's code, and communicate with the robot's frontend.

Teams compete in 2 vs. 2 matches that pit the blue alliance against the gold alliance.
An alliance wins if it collectively scores the most points.
Matches are played in two periods.
During the autonomous period, robots must rely on sensors instead of player control to navigate the field.
Teleop (teleoperation) follows autonomous and allows players to control their robots using a gamepad (Xbox controller).

Some games have coding challenges that allow students to exercise their algorithmic skills.
Usually, these challenges are of the competitive programming flavor and are not relevant for controlling the robot.
For example, counting the ways to make change using different coin denominations is a challenge with a representative difficulty.
Challenges are optional but may reward successful teams with score bonuses or powerups.

Features
--------

* Read, write, and store Smart Device (SD) data.
* Provide a student API for students to read/write SD and gamepad data.
* Provide a control API for clients to start/stop execution of student code.
* Execute a student-written ``main`` function at a constant interval during play.
* Accept gamepad inputs from the student during teleop.
* Publish log and Smart Device data to the frontend.

Out-of-scope:
  * A GUI, which is provided by a separate frontend (Dawn).
    Runtime itself is a command line application.
  * Game mechanics.
    All game logic and interfaces are centralized in field control to eliminate coordinated cross-project updates every season, which can introduce incompatibility.
    For this reason, Dawn, whose scope is limited to robot control, also implements no game mechanics.

Requirements
------------

1. **Performance**: Optimize for latency on the critical path from moving a joystick to actuation.
   Poor performance during teleop can make the robot seem unresponsive and result in a frustrating student experience.
2. **Safety**: Motors and other powerful electronics can pose a physical/electrical hazard and require a reliable emergency stop.
3. **Robustness**: Many PiE students are programming novices who may write buggy code that Runtime should run to the best of its ability.
   Some faults, like referencing a nonexistent device, should not halt execution and should emit a warning instead of crashing.
   Likewise, features like hotplugging reduce the likelihood that students forfeit a match because of a hardware issue outside their control.
4. **Debugging**: Tracing and profiling are essential.
   Performance options should be tunable.
5. **Modularity**: The control stack should be flexible enough to support the following use cases:

   * **Development**: A team works on a physical robot over a LAN created by a PiE-provided router.
   * **Simulation (local)**: Dawn spawns a simulator instance that feeds virtual SD data to Runtime, which still runs on a physical robot's Pi.
   * **Simulation (cloud)**: A team uses a Runtime instance hosted in the cloud to simulate their robot.
     No hardware is required.
   * **Competition**: Four robots compete on a field.
     Each robot is connected over a staff-managed router to a field control station running Dawn.
     A field control station supervises the robots.

6. **Ease-of-use**: Students have a range of programming experience.
   Keep the API simple, but provide enough high-level tools (*e.g.*, PID) to free up student creativity on tackling the game's challenges.
7. **Backwards compatibility**: Avoid breaking changes to promote hardware reuse and reduce software update frequency.
   This is especially relevant for SDs, which can only be updated through flashing.

.. Note::
  Securing Runtime is impossible because the Raspberry Pi's Micro SD card is editable and already in students' possession.
  The competition itself is held on private LANs.
  In theory, one team could sabotage another by programming its robot to send bad packets to its peers, but high school students are unlikely to perform such an attack.
