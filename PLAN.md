# Project Plan for AppZap

This document outlines the initial directory structure and the key files
required for the macOS process manager web application described in the README.

## Directory Structure

```
AppZap/
├── README.md            # existing project description and specs
├── PLAN.md              # this planning document
├── cgi-bin/             # backend Python CGI scripts
│   ├── sysinfo.py       # main API endpoint for process info and actions
│   └── kill_list.json   # persistent storage for processes to auto-kill
└── static/              # frontend assets served via Apache
    ├── index.html       # main HTML UI
    ├── app.js           # JavaScript to fetch and display process data
    └── style.css        # basic styling for the UI
```

## Implementation Notes

- **Python Backend** will expose the actions described in the README via query
  parameters. It will rely on `psutil` for process stats and read/write
  `kill_list.json` for persistence.
- **Frontend** will periodically call `sysinfo.py?action=list` via AJAX and
  render a table with process information. Basic buttons will allow killing a
  process and adding it to the kill list.
- This is an initial skeleton. More advanced features from the README (labels,
  modal UI, system process identification) can be added iteratively.
