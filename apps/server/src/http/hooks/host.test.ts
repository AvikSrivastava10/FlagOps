import { describe, expect, it } from 'vitest';
import { hostnameOf } from './host.js';

describe('hostnameOf', () => {
  it.each([
    ['localhost:3000', 'localhost'],
    ['LocalHost', 'localhost'],
    ['127.0.0.1:8080', '127.0.0.1'],
    ['[::1]:3000', '[::1]'],
    ['[::1]', '[::1]'],
    ['flagops.example.com', 'flagops.example.com'],
  ])('reads %s as %s', (host, hostname) => {
    expect(hostnameOf(host)).toBe(hostname);
  });

  it.each(['', ':3000', '[::1'])('finds no hostname in "%s"', (host) => {
    expect(hostnameOf(host)).toBeUndefined();
  });
});
