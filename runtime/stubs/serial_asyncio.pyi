import asyncio
from typing import Any, Optional

async def open_serial_connection(
    *,
    loop: Optional[asyncio.AbstractEventLoop] = ...,
    limit: Optional[int] = ...,
    **kwargs: Any,
) -> tuple[asyncio.StreamReader, asyncio.StreamWriter]: ...
