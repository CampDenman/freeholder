// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import {describe,it,expect} from 'vitest';
import {parseDeploymentOperatorRequest} from '../../scripts/deployment-admission.mjs';
const base={action:'begin',operationId:'11111111-1111-4111-8111-111111111111',token:'7'.repeat(64),sourceRevision:'a'.repeat(40)};
describe('C10.33 trusted local operator bounded authority',()=>{
  it('accepts only exact own operation/source/secret and known release proof',()=>{
    expect(parseDeploymentOperatorRequest(base).tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(parseDeploymentOperatorRequest({...base,action:'release',proof:'published'}).proof).toBe('published');
    for(const invalid of [{...base,token:'short'},{...base,sourceRevision:'latest'},{...base,action:'force_end'},{...base,owner:'forged'},
      {...base,proof:'published'},{...base,action:'release',proof:'timeout'},{...base,operationId:'../foreign'}])expect(()=>parseDeploymentOperatorRequest(invalid)).toThrow('deployment_request_invalid');
  });
});
