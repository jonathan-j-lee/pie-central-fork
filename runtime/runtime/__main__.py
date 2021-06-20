import multiprocessing

from .cli import cli

if __name__ == '__main__':
    multiprocessing.set_start_method('spawn')
    cli(prog_name=f'python -m {__package__}')  # pylint: disable=no-value-for-parameter
