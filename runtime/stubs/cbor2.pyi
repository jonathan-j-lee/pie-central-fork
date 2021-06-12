from typing import Any

class CBORError(Exception): ...
class CBOREncodeError(CBORError): ...
class CBORDecodeError(CBORError): ...

def dumps(obj: Any) -> bytes: ...
def loads(buf: bytes) -> Any: ...