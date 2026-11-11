#!/usr/bin/env python3
"""Shared OTP client: MCP over stdio, or a small CLI. No third-party dependencies."""
import argparse
import json
import os
from pathlib import Path
import sys
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parent
CONFIG = ROOT / 'config.json'


def settings():
    config = json.loads(CONFIG.read_text())
    if os.environ.get(config['token_env']):
        return config['url'], os.environ[config['token_env']]
    credential_file = Path(config['credentials_file']).expanduser()
    if not credential_file.is_absolute():
        credential_file = CONFIG.parent / credential_file
    secrets = {}
    for line in credential_file.read_text().splitlines():
        key, sep, value = line.partition('=')
        if sep:
            try: secrets[key] = json.loads(value)
            except ValueError: secrets[key] = value.strip().strip('"').strip("'")
    return config['url'], secrets[config['token_env']]


def call(path, data):
    url, token = settings()
    request = urllib.request.Request(url + path, data=json.dumps(data).encode(),
        headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(request, timeout=35) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        try:
            return json.load(error)
        except ValueError:
            return {'error': 'bridge_http_error', 'status': error.code}
    except (OSError, ValueError):
        return {'error': 'bridge_unavailable'}


TOOLS = json.loads((ROOT / 'tools.json').read_text())
ROUTES = {'otp_list_recent': '/v1/recent', 'otp_wait_for': '/v1/recent', 'otp_claim': '/v1/claim', 'otp_history': '/v1/history'}


def mcp():
    for line in sys.stdin:
        message = None
        try:
            message = json.loads(line)
            if 'id' not in message:
                continue
            method = message.get('method')
            if method == 'initialize':
                result = {'protocolVersion': '2024-11-05', 'capabilities': {'tools': {}},
                          'serverInfo': {'name': 'otp-inbox', 'version': '3.0.0'}}
            elif method == 'ping':
                result = {}
            elif method == 'tools/list':
                result = {'tools': TOOLS}
            elif method == 'tools/call':
                params = message.get('params', {})
                name = params.get('name')
                if name not in ROUTES:
                    raise ValueError('Unknown tool')
                arguments = dict(params.get('arguments', {}))
                if name == 'otp_wait_for':
                    arguments.setdefault('wait_seconds', 25)
                data = call(ROUTES[name], arguments)
                result = {'content': [{'type': 'text', 'text': json.dumps(data)}], 'isError': 'error' in data}
            else:
                print(json.dumps({'jsonrpc': '2.0', 'id': message['id'], 'error': {'code': -32601, 'message': 'Method not found'}}), flush=True)
                continue
            print(json.dumps({'jsonrpc': '2.0', 'id': message['id'], 'result': result}), flush=True)
        except Exception:
            # Never echo requests, credentials, or codes in error output.
            print(json.dumps({'jsonrpc': '2.0', 'id': message.get('id') if isinstance(message, dict) else None,
                              'error': {'code': -32603, 'message': 'OTP client failed; check local configuration'}}), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', type=Path, default=CONFIG)
    parser.add_argument('action', choices=['mcp', 'recent', 'wait', 'claim'])
    parser.add_argument('--service')
    parser.add_argument('--since')
    parser.add_argument('--account')
    parser.add_argument('--channel', choices=['sms', 'email'])
    parser.add_argument('--id')
    parser.add_argument('--max-age-seconds', type=int, default=300)
    parser.add_argument('--wait-seconds', type=int, default=25)
    args = parser.parse_args()
    CONFIG = args.config
    if args.action == 'mcp':
        mcp()
    else:
        if args.action == 'claim':
            if not args.id:
                parser.error('--id is required for claim')
            route, data = '/v1/claim', {'id': args.id}
        else:
            route, data = '/v1/recent', {'max_age_seconds': args.max_age_seconds}
            if args.action == 'wait':
                data['wait_seconds'] = args.wait_seconds
            if args.since:
                data['since'] = args.since
        if args.action != 'claim':
            if args.account: data['account'] = args.account
            if args.channel: data['channel'] = args.channel
        if args.service:
            data['service'] = args.service
        print(json.dumps(call(route, data)))
