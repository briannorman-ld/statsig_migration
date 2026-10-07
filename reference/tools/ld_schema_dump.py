import json,sys
import os
d=json.load(open(os.path.join(os.path.dirname(__file__),'..','launchdarkly','openapi.json')))
S=d['components']['schemas']
def show(name):
    s=S[name]; print('##',name,'required=',s.get('required'))
    for k,v in s.get('properties',{}).items():
        r=v.get('$ref') or (v.get('items') or {}).get('$ref')
        print('  ',k, v.get('type',''), 'enum='+str(v.get('enum')) if v.get('enum') else '', '->'+r.split('/')[-1] if r else '', '|', (v.get('description') or '')[:200].replace('\n',' '))
for n in sys.argv[1:]: show(n)
