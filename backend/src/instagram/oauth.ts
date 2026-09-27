import { env } from "../config/env.js";
import { logger } from "../logger.js";
import { randomToken } from "../crypto.js";

/**
 * Official Instagram OAuth (via Meta Login for Business / Instagram API with
 * Instagram Login). No passwords are ever collected or stored.
 *
 * Flow:
 *   1. buildAuthorizeUrl()      -> user opens this in a browser
 *   2. Meta redirects to        -> GET /instagram/oauth/callback?code=...
 *   3. exchangeCodeForToken()   -> short-lived token
 *   4. exchangeForLongLived()   -> 60-day token stored encrypted-at-rest
 *
 * NOTE (Meta requirements): Instagram Messaging via the Graph API requires an
 * Instagram *professional* (Business or Creator) account, a Meta developer app
 * with the instagram_business_basic / instagram_business_manage_messages
 * permissions, and completed App Review for production Mode. This integration
 * is fully implemented and activates automatically once INSTAGRAM_APP_ID /
 * INSTAGRAM_APP_SECRET are configured; until then the MockInstagramProvider is
 * used and the UI clearly shows "Mock mode".
 */

export interface OAuthTokens {
  accessToken: string;
  tokenType: string;
  expiresIn?: number;
  scope?: string;
}

export interface InstagramProfile {
  igUserId: string;
  username: string;
  accountType?: string;
}

export class InstagramOAuthService {
  private fetchFn: typeof fetch;

  constructor(fetchFn: typeof fetch = fetch) {
    this.fetchFn = fetchFn;
  }

  get configured(): boolean {
    return Boolean(env.instagramAppId && env.instagramAppSecret);
  }

  buildAuthorizeUrl(state: string, redirectUri: string): string {
    if (!env.instagramAppId) {
      throw new Error("instagram_not_configured");
    }
    const params = new URLSearchParams({
      client_id: env.instagramAppId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments",
      state,
    });
    return "https://www.instagram.com/oauth/authorize?" + params.toString();
  }

  newCsrfState(): string {
    return randomToken(24);
  }

  async exchangeCodeForToken(
    code: string,
    redirectUri: string,
  ): Promise<OAuthTokens> {
    const res = await this.fetchFn(
      "https://api.instagram.com/oauth/access_token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: env.instagramAppId ?? "",
          client_secret: env.instagramAppSecret ?? "",
          grant_type: "authorization_code",
          redirect_uri: redirectUri,
          code,
        }),
      },
    );
    if (!res.ok) {
      logger.warn("oauth token exchange failed", { status: res.status });
      throw new Error("oauth_exchange_failed");
    }
    const json = (await res.json()) as {
      access_token: string;
      token_type: string;
      expires_in?: number;
      scope?: string;
    };
    return {
      accessToken: json.access_token,
      tokenType: json.token_type,
      expiresIn: json.expires_in,
      scope: json.scope,
    };
  }

  async exchangeForLongLived(shortLived: string): Promise<OAuthTokens> {
    const params = new URLSearchParams({
      client_secret: env.instagramAppSecret ?? "",
      grant_type: "ig_exchange_token",
      access_token: shortLived,
    });
    const res = await this.fetchFn(
      "https://graph.instagram.com/access_token?" + params.toString(),
    );
    if (!res.ok) throw new Error("oauth_longlived_failed");
    const json = (await res.json()) as { access_token: string; expires_in?: number };
    return { accessToken: json.access_token, tokenType: "bearer", expiresIn: json.expires_in };
  }

  async getProfile(accessToken: string): Promise<InstagramProfile> {
    // Instagram API with Instagram Login: GET /me?fields=user_id,username,account_type
    const params = new URLSearchParams({
      fields: "user_id,username,account_type",
      access_token: accessToken,
    });
    const res = await this.fetchFn(
      "https://graph.instagram.com/me?" + params.toString(),
    );
    if (!res.ok) throw new Error("profile_fetch_failed");
    const json = (await res.json()) as {
      user_id: string;
      username: string;
      account_type?: string;
    };
    return {
      igUserId: json.user_id,
      username: json.username,
      accountType: json.account_type,
    };
  }
}

export const instagramOAuth = new InstagramOAuthService();
