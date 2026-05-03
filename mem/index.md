# Project Memory

## Core
Never bump APP_VERSION_LETTER on your own. Only bump it when the user explicitly gives a stamp letter (e.g. "DV") or provides a stamped doc/file. When given, finish all related work first, then set APP_VERSION_LETTER in src/components/dev/DevOverlay.tsx to that exact letter.
