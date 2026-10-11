// @vitest-environment node

import { ApiClient, AuthError, NetworkError } from '@microsoft/rayfin-lib';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Auth, type AuthStorage } from '../Auth';
import { AuthApi } from '../AuthApi';

const code = 'ArtifactBlockedByAdmin';
const message =
  'This app has been blocked by your admin. Reach out to the app owner to get unblocked.';
const requestId = '44444444-4444-4444-4444-444444444444';
const instances: Auth[] = [];

function blocked() {
  return Response.json(
    {
      code,
      httpStatusCode: 403,
      message: 'SYNTHETIC-PRIVATE-RESPONSE',
      details: [{ code: 'RootActivityId', message: requestId }],
    },
    { status: 403 }
  );
}

function tokens(user = 'synthetic-user') {
  return Response.json({
    accessToken: `e30.${btoa(JSON.stringify({ sub: user }))}.signature`,
    tokenType: 'Bearer',
    expiresIn: 3600,
    refreshToken: 'SYNTHETIC-REFRESH-TOKEN',
  });
}

function setup(storage: AuthStorage | false = false) {
  const fetch = vi.fn<typeof globalThis.fetch>();
  const client = new ApiClient({
    baseUrl: 'https://api.example.com',
    publishableKey: 'public-key',
    fetch,
  });
  const auth = new Auth(client, { storage, autoRefreshToken: false });
  instances.push(auth);
  auth.attachToClient(client);
  return { client, auth, fetch };
}

const credentials = {
  email: 'user@example.com',
  password: 'synthetic-password',
};

afterEach(() => {
  instances.splice(0).forEach((auth) => auth.destroy());
  vi.restoreAllMocks();
});

describe('administrator-block auth propagation', () => {
  it.each(['signin', 'refresh', 'code'] as const)(
    'preserves a typed response rejection through the %s mapping',
    async (operation) => {
      const { client, fetch } = setup();
      const api = new AuthApi(client);
      fetch.mockResolvedValueOnce(blocked());
      const result =
        operation === 'signin'
          ? api.signIn(credentials)
          : operation === 'refresh'
            ? api.refreshToken('SYNTHETIC-REFRESH-TOKEN')
            : api.exchangeVerificationCode({
                verificationCode: 'SYNTHETIC-HANDOFF',
                codeVerifier: 'SYNTHETIC-VERIFIER',
                redirectUri: 'https://app.example.com',
              });
      const error = await result.catch((error: unknown) => error);
      expect(error).toBeInstanceOf(AuthError);
      expect(error).toMatchObject({ code, status: 403, message, requestId });
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  );

  it('keeps generic sign-in 403 mappings unchanged', async () => {
    const { client, fetch } = setup();
    fetch.mockResolvedValueOnce(
      Response.json({ message: 'Verify your email.' }, { status: 403 })
    );
    await expect(new AuthApi(client).signIn(credentials)).rejects.toMatchObject(
      {
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Verify your email.',
      }
    );
  });

  it('does not give a fetch-thrown AuthError service attribution', async () => {
    const { client, fetch } = setup();
    fetch.mockRejectedValueOnce(
      new AuthError('SYNTHETIC-PRIVATE-RESPONSE', code, 403, requestId)
    );
    const error = await new AuthApi(client)
      .signIn(credentials)
      .catch((error: unknown) => error);
    expect(error).toBeInstanceOf(NetworkError);
    expect(error).not.toHaveProperty('code', code);
    expect(String(error)).not.toContain('SYNTHETIC-PRIVATE-RESPONSE');
  });

  it.each(['signin', 'refresh', 'data'] as const)(
    'does not discard an existing session after a blocked %s request',
    async (operation) => {
      const { auth, client, fetch } = setup();
      fetch.mockResolvedValueOnce(tokens()).mockResolvedValueOnce(blocked());
      await auth.signIn(credentials);
      const previous = auth.getSession();
      const expired = vi.fn();
      const logout = vi.fn();
      const login = vi.fn();
      auth.on('AUTH_SESSION_EXPIRED', expired);
      auth.on('AUTH_LOGOUT', logout);
      auth.on('AUTH_LOGIN', login);
      expect(login).toHaveBeenCalledExactlyOnceWith(previous);
      login.mockClear();

      const result =
        operation === 'signin'
          ? auth.signIn(credentials)
          : operation === 'refresh'
            ? auth.refreshSession()
            : client.get('/resource');
      await expect(result).rejects.toMatchObject({
        code,
        status: 403,
        requestId,
      });
      expect(auth.getSession()).toEqual(previous);
      expect(auth.hasRefreshToken()).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(expired).not.toHaveBeenCalled();
      expect(logout).not.toHaveBeenCalled();
      expect(login).not.toHaveBeenCalled();
    }
  );

  it('preserves the rejection while refresh is backed off instead of retrying', async () => {
    const { auth, fetch } = setup();
    fetch.mockResolvedValueOnce(tokens()).mockResolvedValueOnce(blocked());
    await auth.signIn(credentials);
    await expect(auth.refreshSession()).rejects.toMatchObject({
      code,
      status: 403,
      requestId,
    });
    await expect(auth.refreshSession()).rejects.toMatchObject({
      code,
      status: 403,
      requestId,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(auth.getSession().isAuthenticated).toBe(true);
  });

  it.each(['constructed', 'replayed'] as const)(
    'does not attribute a %s storage failure to the refresh response',
    async (source) => {
      let stored: string | null = null;
      const storage: AuthStorage = {
        getItem: () => stored,
        setItem: vi.fn((_key, value) => {
          stored = value;
        }),
        removeItem: vi.fn(),
      };
      const { auth, client, fetch } = setup(storage);
      fetch.mockResolvedValueOnce(tokens());
      await auth.signIn(credentials);
      await vi.waitFor(() => expect(storage.setItem).toHaveBeenCalledTimes(1));

      let failure: unknown = new AuthError(
        'SYNTHETIC-PRIVATE-RESPONSE',
        code,
        403,
        requestId
      );
      if (source === 'replayed') {
        fetch.mockResolvedValueOnce(blocked());
        const error = await client
          .get('/resource')
          .catch((error: unknown) => error);
        failure = client.getResponseAuthError(error);
        expect(failure).toBeInstanceOf(AuthError);
      }
      vi.mocked(storage.setItem).mockRejectedValueOnce(failure);
      fetch.mockResolvedValueOnce(tokens('refreshed-synthetic-user'));

      const error = await auth
        .refreshSession()
        .catch((error: unknown) => error);

      expect(error).not.toBe(failure);
      expect(error).not.toHaveProperty('code', code);
      expect(error).not.toHaveProperty('requestId');
      expect(String(error)).not.toContain('SYNTHETIC-PRIVATE-RESPONSE');
      await expect(auth.refreshSession()).rejects.toMatchObject({
        code: 'REFRESH_BACKOFF',
      });
      expect(fetch).toHaveBeenCalledTimes(source === 'replayed' ? 3 : 2);
    }
  );

  it.each(['refresh', 'retry'] as const)(
    'stops a 401 recovery when its %s is blocked without losing the code',
    async (blockedAt) => {
      const { auth, client, fetch } = setup();
      fetch.mockResolvedValueOnce(tokens());
      await auth.signIn(credentials);
      const previous = auth.getSession();
      fetch.mockResolvedValueOnce(new Response(null, { status: 401 }));
      if (blockedAt === 'retry') {
        fetch.mockResolvedValueOnce(tokens());
      }
      fetch.mockResolvedValueOnce(blocked());
      const logout = vi.fn();
      auth.on('AUTH_LOGOUT', logout);

      await expect(client.get('/resource')).rejects.toMatchObject({
        code,
        status: 403,
        requestId,
      });

      expect(auth.getSession().user).toEqual(previous.user);
      expect(auth.getSession().isAuthenticated).toBe(true);
      expect(logout).not.toHaveBeenCalled();
      expect(fetch).toHaveBeenCalledTimes(blockedAt === 'refresh' ? 3 : 4);
      expect(fetch.mock.calls.map(([url]) => url)).toEqual([
        'https://api.example.com/api/auth/v1/token',
        'https://api.example.com/resource',
        'https://api.example.com/api/auth/v1/token',
        ...(blockedAt === 'retry' ? ['https://api.example.com/resource'] : []),
      ]);
    }
  );

  it('preserves a blocked refresh across a separately attached data client', async () => {
    const { auth, fetch } = setup();
    fetch.mockResolvedValueOnce(tokens()).mockResolvedValueOnce(blocked());
    await auth.signIn(credentials);
    const dataFetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    const data = new ApiClient({
      baseUrl: 'https://data.example.com',
      publishableKey: 'public-key',
      fetch: dataFetch,
    });
    auth.attachToClient(data);

    await expect(data.get('/resource')).rejects.toMatchObject({
      code,
      status: 403,
      message,
      requestId,
    });

    expect(dataFetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(auth.getSession().isAuthenticated).toBe(true);
  });
});
