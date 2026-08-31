import { isCorsOriginAllowed } from './configure-app';

describe('isCorsOriginAllowed', () => {
  it('allows the production frontend origin', () => {
    expect(isCorsOriginAllowed('https://omniretail-saree-frontend.vercel.app')).toBe(true);
  });

  it('allows Vercel preview URLs for the frontend', () => {
    expect(
      isCorsOriginAllowed('https://omniretail-saree-frontend-git-main-sparkshubham.vercel.app'),
    ).toBe(true);
  });

  it('allows localhost', () => {
    expect(isCorsOriginAllowed('http://localhost:5174')).toBe(true);
  });

  it('rejects unrelated origins', () => {
    expect(isCorsOriginAllowed('https://evil.example')).toBe(false);
  });
});
