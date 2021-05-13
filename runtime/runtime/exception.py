class RuntimeBaseException(Exception):
    def __init__(self, message: str, **context):
        super().__init__(message)
        self.context = context

    def __repr__(self) -> str:
        cls_name, args = self.__class__.__name__, [repr(self.args[0])]
        args.extend(f'{name}={value!r}' for name, value in self.context.items())
        return f'{cls_name}({", ".join(args)})'
