pub mod native_auth;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SecretBackend {
    OsKeychain,
    Stronghold,
}

pub const fn supported_secret_backends() -> [SecretBackend; 2] {
    [SecretBackend::OsKeychain, SecretBackend::Stronghold]
}
