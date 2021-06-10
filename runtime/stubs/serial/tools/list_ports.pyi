from typing import Protocol

class ListPortInfo(Protocol):
    device: str
    name: str
    description: str
    hwid: str
    vid: int
    pid: int
    serial_number: str
    location: str
    manufacturer: str
    product: str
    interface: str

def comports(include_links: bool = ...) -> list[ListPortInfo]: ...
