# Configuration file for the Sphinx documentation builder.
#
# This file only contains a selection of the most common options. For a full
# list see the documentation:
# https://www.sphinx-doc.org/en/master/usage/configuration.html

import types
import typing

# -- Path setup --------------------------------------------------------------

# If extensions (or modules to document with autodoc) are in another directory,
# add these directories to sys.path here. If the directory is relative to the
# documentation root, use os.path.abspath to make it absolute, like shown here.
#
# import os
# import sys
# sys.path.insert(0, os.path.abspath('.'))


# -- Project information -----------------------------------------------------

project = 'Runtime'
copyright = '2021, Pioneers in Engineering'
author = 'Pioneers in Engineering'


# -- General configuration ---------------------------------------------------

# Add any Sphinx extension module names here, as strings. They can be
# extensions coming with Sphinx (named 'sphinx.ext.*') or your custom
# ones.
extensions = [
    'sphinxcontrib.tikz',
    'sphinx.ext.autodoc',
    'sphinx.ext.intersphinx',
    'sphinx.ext.napoleon',
    'sphinx.ext.viewcode',
]

# Add any paths that contain templates here, relative to this directory.
templates_path = ['_templates']

# List of patterns, relative to source directory, that match files and
# directories to ignore when looking for source files.
# This pattern also affects html_static_path and html_extra_path.
exclude_patterns = []


# -- Options for HTML output -------------------------------------------------

# The theme to use for HTML and HTML Help pages.  See the documentation for
# a list of builtin themes.
html_theme = 'press'

# Add any paths that contain custom static files (such as style sheets) here,
# relative to this directory. They are copied after the builtin static files,
# so a file named "default.css" will overwrite the builtin "default.css".
html_static_path = ['_static']

# These paths are either relative to html_static_path
# or fully qualified paths (eg. https://...)
html_css_files = [
    'css/custom.css',
]


# -- TikZ options -------------------------------------------------------------

tikz_latex_preamble = r"""
"""


# -- Intersphinx Options ------------------------------------------------------

intersphinx_mapping = {
    'python': ('https://docs.python.org/3', None),
    'click': ('https://click.palletsprojects.com/en/8.0.x', None),
    'structlog': ('https://structlog.org/en/21.1.0', None),
    'zmq': ('https://pyzmq.readthedocs.io/en/v22.3.0', None),
}


# -- Autodoc Options ----------------------------------------------------------

autodoc_docstring_signature = True
autodoc_typehints = 'description'
autodoc_typehints_description_target = 'documented'
autodoc_inherit_docstrings = False
autodoc_type_aliases = {
}

# -- AutoAPI Options ----------------------------------------------------------

# autoapi_dirs = ['../../runtime']
# autoapi_options = [
#     'members',
#     'undoc-members',
#     'show-inheritance',
#     'show-module-summary',
#     'special-members',
#     'imported-members',
# ]
# autoapi_member_order = 'groupwise'
# autoapi_keep_files = False

# -- Setup --------------------------------------------------------------------

# HACK: Using an internal is always a bad idea, but polluting the sphinx documentation
# with useless autogenerated fields is worse
# https://github.com/sphinx-doc/sphinx/issues/7353
from collections import _tuplegetter

def omit_namedtuple_attr_docstring(app, what, name, obj, skip, options):
    if isinstance(obj, _tuplegetter):
        return True

def setup(app):
    app.connect('autodoc-skip-member', omit_namedtuple_attr_docstring)
