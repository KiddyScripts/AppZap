#!/usr/bin/env python3
"""CGI script providing process information and control endpoints."""

import urllib.parse
import json
import os
import psutil
from pathlib import Path


class SimpleForm:
    """Minimal replacement for deprecated ``cgi.FieldStorage``."""

    def __init__(self):
        qs = os.environ.get("QUERY_STRING", "")
        # ``parse_qs`` returns lists of values; we only need the first
        self.data = {k: v[0] for k, v in urllib.parse.parse_qs(qs).items()}

    def getfirst(self, key, default=None):
        return self.data.get(key, default)

KILL_LIST_PATH = Path(__file__).with_name('kill_list.json')


def load_kill_list():
    if KILL_LIST_PATH.exists():
        with open(KILL_LIST_PATH) as f:
            try:
                return json.load(f)
            except json.JSONDecodeError:
                return []
    return []


def save_kill_list(kill_list):
    with open(KILL_LIST_PATH, 'w') as f:
        json.dump(kill_list, f)


def list_processes():
    procs = []
    for p in psutil.process_iter(['pid', 'name', 'username', 'cpu_percent', 'memory_percent', 'ppid']):
        try:
            info = p.info
            procs.append({
                'pid': info['pid'],
                'name': info['name'],
                'cpu_percent': info['cpu_percent'],
                'memory_percent': info['memory_percent'],
                'ppid': info['ppid'],
                'user': info['username'],
            })
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    return procs


def kill_process(pid: int):
    try:
        p = psutil.Process(pid)
        p.kill()
        return True
    except (psutil.NoSuchProcess, psutil.AccessDenied):
        return False


def handle_action(action, form):
    if action == 'list':
        return {'processes': list_processes()}

    elif action == 'kill':
        pid = int(form.getfirst('pid', '-1'))
        success = kill_process(pid)
        return {'killed': success, 'pid': pid}

    elif action == 'add_kill_list':
        pid = int(form.getfirst('pid', '-1'))
        kill_list = load_kill_list()
        if pid not in kill_list:
            kill_list.append(pid)
            save_kill_list(kill_list)
        return {'kill_list': kill_list}

    elif action == 'remove_kill_list':
        pid = int(form.getfirst('pid', '-1'))
        kill_list = load_kill_list()
        if pid in kill_list:
            kill_list.remove(pid)
            save_kill_list(kill_list)
        return {'kill_list': kill_list}

    elif action == 'kill_loop_check':
        kill_list = load_kill_list()
        killed = []
        for pid in list(kill_list):
            if kill_process(pid):
                killed.append(pid)
        return {'killed': killed}

    return {'error': 'unknown action'}


def main():
    form = SimpleForm()
    action = form.getfirst('action', 'list')
    result = handle_action(action, form)
    print('Content-Type: application/json\n')
    print(json.dumps(result))


if __name__ == '__main__':
    main()
