"""Create a private import file. The ingest key never enters console output."""
from pathlib import Path
import os
import json
import argparse
import plistlib
import re
import uuid

def uid():
    return str(uuid.uuid4()).upper()

def text(value, attachment=None):
    data = {'string': value}
    if attachment:
        data['attachmentsByRange'] = {'{0, 1}': attachment}
    return {'Value': data, 'WFSerializationType': 'WFTextTokenString'}

def output(identifier, name):
    return {'Type': 'ActionOutput', 'OutputUUID': identifier, 'OutputName': name}

def dictionary(items):
    return {'Value': {'WFDictionaryFieldValueItems': [
        {'WFItemType': 0, 'WFKey': text(k), 'WFValue': v} for k, v in items.items()]},
        'WFSerializationType': 'WFDictionaryFieldValue'}

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--settings',type=Path,default=Path(__file__).resolve().parents[1]/'.local/settings.json')
args=parser.parse_args()
config=json.loads(args.settings.read_text())
label = re.search(r'const LABEL = /(.*)/ig;', (Path(__file__).resolve().parents[1]/'server.ts').read_text()).group(1)
phone_pattern = r'(?is)^(?:(?=.*(?:' + label + r')).+|\s*(?=[A-Z\d-]*\d)[A-Z\d-]{4,12}\s*)$'
date_id, match_id = uid(), uid()
actions = [
    {'WFWorkflowActionIdentifier': 'is.workflow.actions.format.date', 'WFWorkflowActionParameters': {
        'UUID': date_id, 'WFDate': text('\ufffc', {'Type': 'CurrentDate'}),
        'WFDateFormatStyle': 'Custom', 'WFDateFormat': "yyyy-MM-dd'T'HH:mm:ss.SSSXXXXX"}},
    {'WFWorkflowActionIdentifier': 'is.workflow.actions.text.match', 'WFWorkflowActionParameters': {
        'UUID': match_id, 'WFMatchTextPattern': phone_pattern,
        'text': text('\ufffc', {'Type': 'ExtensionInput'})}},
    {'WFWorkflowActionIdentifier': 'is.workflow.actions.downloadurl', 'WFWorkflowActionParameters': {
        'UUID': uid(), 'WFURL': config['url']+'/v1/sms', 'WFHTTPMethod': 'POST',
        'ShowHeaders': True, 'WFHTTPHeaders': dictionary({'Authorization': text('Bearer '+config['ingest_token'])}),
        'WFHTTPBodyType': 'JSON', 'WFJSONValues': dictionary({
            'message': text('\ufffc', output(match_id, 'Matches')),
            'received_at': text('\ufffc', output(date_id, 'Formatted Date'))})}},
]
workflow = {'WFWorkflowName': 'OTP Inbox', 'WFWorkflowClientVersion': '2302.0.4',
    'WFWorkflowMinimumClientVersion': 900, 'WFWorkflowMinimumClientVersionString': '900',
    'WFWorkflowIcon': {'WFWorkflowIconStartColor': 4282601983, 'WFWorkflowIconGlyphNumber': 59511},
    'WFWorkflowTypes': [], 'WFWorkflowInputContentItemClasses': ['WFStringContentItem'],
    'WFWorkflowHasShortcutInputVariables': True, 'WFWorkflowActions': actions,
    'WFWorkflowImportQuestions': [], 'WFWorkflowOutputContentItemClasses': []}
path = args.settings.parent / 'OTP Inbox.unsigned.shortcut'
with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), 'wb') as handle:
    plistlib.dump(workflow, handle, fmt=plistlib.FMT_BINARY)
print('Private shortcut file created (key hidden).')
