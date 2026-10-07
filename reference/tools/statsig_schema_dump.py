import json,sys
import os
s=json.load(open(os.path.join(os.path.dirname(__file__),'..','statsig','console-api-openapi-20240601.json')))
def res(r):
    parts=r.lstrip('#/').split('/')
    o=s
    for p in parts: o=o[p]
    return o
def show(sch,ind=0,depth=0,seen=()):
    pad='  '*ind
    if '$ref' in sch:
        name=sch['$ref'].split('/')[-1]
        if name in seen or depth>9: print(pad+'<'+name+'>'); return
        sch=res(sch['$ref']); seen=seen+(name,)
    for k in ('allOf','anyOf','oneOf'):
        if k in sch:
            print(pad+k+':')
            for x in sch[k]: show(x,ind+1,depth+1,seen)
            return
    t=sch.get('type')
    if t=='object' or 'properties' in sch:
        req=set(sch.get('required',[]))
        for pn,pv in sch.get('properties',{}).items():
            pv2=res(pv['$ref']) if '$ref' in pv else pv
            tt=pv2.get('type','')
            extra=''
            if 'enum' in pv2: extra=' enum='+json.dumps(pv2['enum'])
            if pv2.get('nullable'): extra+=' nullable'
            d=(pv2.get('description') or '').replace('\n',' ')[:140]
            print(f"{pad}{pn}{'*' if pn in req else ''}: {tt}{extra}  # {d}")
            if tt=='object' or 'properties' in pv2 or any(k in pv2 for k in ('allOf','anyOf','oneOf')):
                show(pv,ind+1,depth+1,seen)
            elif tt=='array':
                it=pv2.get('items',{})
                it2=res(it['$ref']) if '$ref' in it else it
                if 'enum' in it2: print(pad+'  items enum='+json.dumps(it2['enum']))
                if it2.get('type')=='object' or 'properties' in it2 or any(k in it2 for k in ('allOf','anyOf','oneOf')):
                    print(pad+'  [items]'); show(it,ind+2,depth+1,seen)
                else: print(pad+'  items: '+str(it2.get('type')))
        ap=sch.get('additionalProperties')
        if ap and isinstance(ap,dict): print(pad+'additionalProperties:'); show(ap,ind+1,depth+1,seen)
    elif t=='array':
        print(pad+'[array]'); show(sch.get('items',{}),ind+1,depth+1,seen)
    else:
        print(pad+str(t)+(' enum='+json.dumps(sch['enum']) if 'enum' in sch else ''))
path,method=sys.argv[1],sys.argv[2] if len(sys.argv)>2 else 'get'
op=s['paths'][path][method]
for code,r in op['responses'].items():
    if '$ref' in r: r=res(r['$ref'])
    c=r.get('content',{}).get('application/json',{}).get('schema')
    if c and code.startswith('2'):
        print('==',code); show(c)
