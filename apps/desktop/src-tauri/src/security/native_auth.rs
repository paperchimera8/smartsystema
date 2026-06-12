use serde::Serialize;
use thiserror::Error;
use url::Url;

#[derive(Debug, Error, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ExternalAuthOpenError {
    #[error("Auth URL must be a valid http or https URL.")]
    InvalidUrl,
    #[error("Auth URL must not include credentials, fragments, or secret query parameters.")]
    UnsafeUrl,
    #[error("System browser could not be opened.")]
    BrowserOpenFailed,
}

pub fn validate_external_auth_url(raw_url: &str) -> Result<(), ExternalAuthOpenError> {
    let url = Url::parse(raw_url.trim()).map_err(|_| ExternalAuthOpenError::InvalidUrl)?;

    if url.scheme() != "http" && url.scheme() != "https" {
        return Err(ExternalAuthOpenError::InvalidUrl);
    }

    if !url.username().is_empty() || url.password().is_some() || url.fragment().is_some() {
        return Err(ExternalAuthOpenError::UnsafeUrl);
    }

    for (key, _) in url.query_pairs() {
        let lower_key = key.to_ascii_lowercase();

        if matches!(
            lower_key.as_str(),
            "access_token"
                | "api_key"
                | "apikey"
                | "auth"
                | "authorization"
                | "client_secret"
                | "password"
                | "pwd"
                | "refresh_token"
                | "secret"
                | "token"
        ) {
            return Err(ExternalAuthOpenError::UnsafeUrl);
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{validate_external_auth_url, ExternalAuthOpenError};

    #[test]
    fn accepts_http_and_https_login_urls() {
        assert!(validate_external_auth_url(
            "http://127.0.0.1:8082/api/auth/native/login?requestId=auth-1&state=opaque"
        )
        .is_ok());
        assert!(validate_external_auth_url(
            "https://api.example.test/api/auth/native/login?requestId=auth-1&state=opaque"
        )
        .is_ok());
    }

    #[test]
    fn rejects_non_http_credentials_fragments_and_secret_query() {
        assert_eq!(
            validate_external_auth_url("file:///tmp/auth").unwrap_err(),
            ExternalAuthOpenError::InvalidUrl
        );
        assert_eq!(
            validate_external_auth_url("https://user:password@example.test/auth").unwrap_err(),
            ExternalAuthOpenError::UnsafeUrl
        );
        assert_eq!(
            validate_external_auth_url("https://example.test/auth#token").unwrap_err(),
            ExternalAuthOpenError::UnsafeUrl
        );
        assert_eq!(
            validate_external_auth_url("https://example.test/auth?access_token=secret")
                .unwrap_err(),
            ExternalAuthOpenError::UnsafeUrl
        );
    }
}
