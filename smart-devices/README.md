# Smart Device Libraries and Bindings

`sdmlib` is a cross-platform C++11 library for encoding and decoding Smart Device messages.
The library has bindings for Python and NodeJS for use in Runtime and the Simulator, respectively.

`SmartDevice` is an Arduino library that uses `sdmlib` to implement the Smart Device protocol.
This library implements functionality common to all Smart Devices, including message queueing, parameter storage, and interfacing with the hardware.

Finally, there are Arduino `sketches` for each type of Smart Device.
These sketches complete `sdlib` stubs that implement functionality specific to each device type.
