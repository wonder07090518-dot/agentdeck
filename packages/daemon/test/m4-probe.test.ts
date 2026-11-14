import { describe, expect, it } from 'vitest';
import { parseQuotaFromObject, parseQuotaFromText } from '../src/probe.js';

describe('parseQuotaFromText',()=>{
  it('returns null when no remaining number is present',()=>{
    expect(parseQuotaFromText('Logged in using ChatGPT')).toBeNull();
    expect(parseQuotaFromText('{"loggedIn":true,"subscriptionType":"pro"}')).toBeNull();
  });
  it('parses an explicit remaining amount and never invents one',()=>{
    expect(parseQuotaFromText('Usage: remaining credits 37')).toMatchObject({known:true,remaining:37,unit:'units'});
    expect(parseQuotaFromText('12% remaining')).toMatchObject({known:true,remaining:12,unit:'%'});
    expect(parseQuotaFromText('剩余 8 次')).toMatchObject({known:true,remaining:8});
  });
});

describe('parseQuotaFromObject',()=>{
  it('reads remaining only from structured fields',()=>{
    expect(parseQuotaFromObject({loggedIn:true})).toBeNull();
    expect(parseQuotaFromObject({usage:{remaining:21,unit:'requests',limit:50}})).toEqual({known:true,remaining:21,unit:'requests',limit:50});
  });
});
