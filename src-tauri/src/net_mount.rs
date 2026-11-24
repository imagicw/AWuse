/// 网络根来源解析:把用户输入的远端共享地址拆成「可挂载单元」与「共享内子路径」。
/// 支持 `smb://server/share[/sub/dir]` 与 Windows UNC `\\server\share[\sub\dir]` 两种形态。
use std::path::PathBuf;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NetworkSource {
    pub server: String,
    pub share: String,
    pub sub_path: String,
}

impl NetworkSource {
    /// 交给操作系统挂载的地址(挂整个 share,不含子路径)。
    pub fn mount_uri(&self) -> String {
        #[cfg(target_os = "windows")]
        {
            format!("\\\\{}\\{}", self.server, self.share)
        }
        #[cfg(not(target_os = "windows"))]
        {
            format!("smb://{}/{}", self.server, self.share)
        }
    }
}

fn join_segments(segments: &[&str]) -> String {
    segments
        .iter()
        .filter(|s| !s.is_empty())
        .copied()
        .collect::<Vec<_>>()
        .join("/")
}

pub fn parse_network_source(raw: &str) -> Result<NetworkSource, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("网络共享地址不能为空".to_string());
    }

    let (server, share, sub_path) = if trimmed.len() >= 6
        && trimmed[..6].eq_ignore_ascii_case("smb://")
    {
        let mut segments = trimmed[6..].split('/');
        let server = segments.next().unwrap_or("");
        let share = segments.next().unwrap_or("");
        (
            server.to_string(),
            share.to_string(),
            join_segments(&segments.collect::<Vec<_>>()),
        )
    } else if trimmed.starts_with("\\\\") {
        let rest = &trimmed[2..];
        let mut segments = rest.split(['\\', '/']);
        let server = segments.next().unwrap_or("");
        let share = segments.next().unwrap_or("");
        (
            server.to_string(),
            share.to_string(),
            join_segments(&segments.collect::<Vec<_>>()),
        )
    } else {
        return Err("仅支持 smb://server/share 或 \\\\server\\share 格式".to_string());
    };

    if server.is_empty() {
        return Err("网络共享地址缺少服务器主机名".to_string());
    }
    if share.is_empty() {
        return Err("网络共享地址缺少共享名(如 smb://server/share)".to_string());
    }

    Ok(NetworkSource {
        server,
        share,
        sub_path,
    })
}

/// 挂载远端共享的副作用边界。生产实现走操作系统,测试注入假实现。
pub trait Mounter {
    fn mount(&self, mount_uri: &str) -> Result<(), String>;
}

/// 通过各平台原生机制挂载 SMB 共享;凭据由系统钥匙串/凭据管理器托管。
pub struct OsMounter;

impl Mounter for OsMounter {
    fn mount(&self, mount_uri: &str) -> Result<(), String> {
        #[cfg(target_os = "macos")]
        {
            // `open smb://…` 由 Finder/NetFS 异步完成挂载,凭据交互交给系统。
            let status = std::process::Command::new("open")
                .arg(mount_uri)
                .status()
                .map_err(|e| format!("调用系统挂载失败: {e}"))?;
            if !status.success() {
                return Err(format!("系统挂载 {mount_uri} 失败(exit {status})"));
            }
            Ok(())
        }
        #[cfg(target_os = "windows")]
        {
            let status = std::process::Command::new("net")
                .args(["use", mount_uri])
                .status()
                .map_err(|e| format!("调用系统挂载失败: {e}"))?;
            if !status.success() {
                return Err(format!("net use {mount_uri} 失败(exit {status})"));
            }
            Ok(())
        }
        #[cfg(all(unix, not(target_os = "macos")))]
        {
            let status = std::process::Command::new("gio")
                .args(["mount", mount_uri])
                .status()
                .map_err(|e| format!("调用系统挂载失败: {e}"))?;
            if !status.success() {
                return Err(format!("gio mount {mount_uri} 失败(exit {status})"));
            }
            Ok(())
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows", unix)))]
        {
            Err("当前平台不支持自动挂载网络共享".to_string())
        }
    }
}

/// 保证 Library Root 的本机访问路径可用:
/// - 路径已存在 → 直接返回
/// - 本地根且路径缺失 → 报不可达(不尝试挂载)
/// - 网络根且路径缺失 → 用 source_uri 触发系统挂载,轮询等待挂载点出现
pub fn ensure_root_accessible(
    root_path: &str,
    source_uri: Option<&str>,
    is_network: bool,
    mounter: &dyn Mounter,
    poll_timeout: Duration,
) -> Result<PathBuf, String> {
    let path = PathBuf::from(root_path);
    if path.exists() {
        return Ok(path);
    }

    if !is_network {
        return Err(format!("目录不可达: {root_path}"));
    }

    let uri = source_uri.ok_or_else(|| "网络根缺少 source_uri,无法重新挂载".to_string())?;
    let source = parse_network_source(uri)?;
    mounter.mount(&source.mount_uri())?;

    if poll_path_exists(&path, poll_timeout) {
        return Ok(path);
    }

    // 原挂载点没回来,但 share 可能漂到了别的挂点(如 /Volumes/share-1)——给出可诊断的错误。
    if let Some(drifted) = wait_for_mount_point(&source, Duration::ZERO) {
        return Err(format!(
            "挂载点漂移:{uri} 已重新挂载到 {},但该根登记在 {root_path}。请移除后重新添加。",
            drifted.display()
        ));
    }
    Err(format!("网络根离线: {uri} 挂载后 {root_path} 仍不可达"))
}

/// 轮询直到路径出现或超时;timeout 为 0 时只检查一次。
fn poll_path_exists(path: &PathBuf, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        if path.exists() {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

/// 各平台挂载点的可能位置。macOS Finder 挂在 /Volumes/<share>(重名加 -N 后缀)。
fn mount_point_candidates(source: &NetworkSource) -> Vec<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        (0..5)
            .map(|i| {
                if i == 0 {
                    PathBuf::from(format!("/Volumes/{}", source.share))
                } else {
                    PathBuf::from(format!("/Volumes/{}-{}", source.share, i))
                }
            })
            .collect()
    }
    #[cfg(target_os = "windows")]
    {
        vec![PathBuf::from(format!(
            "\\\\{}\\{}",
            source.server, source.share
        ))]
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        // gvfs 挂载点形如 /run/user/<uid>/gvfs/smb-share:server=x,share=y
        let mut out = Vec::new();
        if let Ok(users) = std::fs::read_dir("/run/user") {
            for user_dir in users.flatten() {
                let gvfs = user_dir.path().join("gvfs");
                if let Ok(entries) = std::fs::read_dir(&gvfs) {
                    for entry in entries.flatten() {
                        let name = entry.file_name().to_string_lossy().to_string();
                        if name.starts_with("smb-share:")
                            && name.contains(&format!("server={}", source.server))
                            && name.contains(&format!("share={}", source.share))
                        {
                            out.push(entry.path());
                        }
                    }
                }
            }
        }
        out
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", unix)))]
    {
        Vec::new()
    }
}

/// 在候选位置中等候挂载点出现;timeout 为 0 时只检查一次(用于「已挂载」快路径)。
pub fn wait_for_mount_point(source: &NetworkSource, timeout: Duration) -> Option<PathBuf> {
    let deadline = Instant::now() + timeout;
    loop {
        for candidate in mount_point_candidates(source) {
            if candidate.exists() {
                return Some(candidate);
            }
        }
        if Instant::now() >= deadline {
            return None;
        }
        std::thread::sleep(Duration::from_millis(250));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_smb_uri_with_share_root() {
        let src = parse_network_source("smb://nas.local/music").unwrap();
        assert_eq!(src.server, "nas.local");
        assert_eq!(src.share, "music");
        assert_eq!(src.sub_path, "");
        assert_eq!(src.mount_uri(), "smb://nas.local/music");
    }

    #[test]
    fn parses_smb_uri_with_sub_path() {
        let src = parse_network_source("smb://192.168.1.10/media/flac/2024").unwrap();
        assert_eq!(src.server, "192.168.1.10");
        assert_eq!(src.share, "media");
        assert_eq!(src.sub_path, "flac/2024");
    }

    #[test]
    fn trailing_slashes_are_ignored() {
        let src = parse_network_source("smb://nas/music/").unwrap();
        assert_eq!(src.sub_path, "");
        let src = parse_network_source("smb://nas/music/a//b/").unwrap();
        assert_eq!(src.sub_path, "a/b");
    }

    #[test]
    fn parses_unc_path() {
        let src = parse_network_source("\\\\NAS\\music\\flac").unwrap();
        assert_eq!(src.server, "NAS");
        assert_eq!(src.share, "music");
        assert_eq!(src.sub_path, "flac");
    }

    #[test]
    fn rejects_missing_share() {
        assert!(parse_network_source("smb://nas.local").is_err());
        assert!(parse_network_source("smb://").is_err());
        assert!(parse_network_source("smb://nas.local/").is_err());
    }

    #[test]
    fn rejects_unsupported_scheme_and_local_path() {
        assert!(parse_network_source("http://nas.local/music").is_err());
        assert!(parse_network_source("/Volumes/music").is_err());
        assert!(parse_network_source("").is_err());
    }

    use std::cell::RefCell;
    use std::path::PathBuf;
    use std::time::Duration;

    struct FakeMounter {
        calls: RefCell<Vec<String>>,
        create_on_mount: Option<PathBuf>,
        fail: bool,
    }

    impl FakeMounter {
        fn new(create_on_mount: Option<PathBuf>, fail: bool) -> Self {
            Self { calls: RefCell::new(vec![]), create_on_mount, fail }
        }
    }

    impl Mounter for FakeMounter {
        fn mount(&self, mount_uri: &str) -> Result<(), String> {
            self.calls.borrow_mut().push(mount_uri.to_string());
            if self.fail {
                return Err("模拟挂载失败".to_string());
            }
            if let Some(p) = &self.create_on_mount {
                std::fs::create_dir_all(p).map_err(|e| e.to_string())?;
            }
            Ok(())
        }
    }

    const NO_WAIT: Duration = Duration::from_millis(60);

    #[test]
    fn local_root_with_existing_path_never_mounts() {
        let dir = tempfile::tempdir().unwrap();
        let mounter = FakeMounter::new(None, false);
        let got = ensure_root_accessible(
            dir.path().to_str().unwrap(),
            None,
            false,
            &mounter,
            NO_WAIT,
        )
        .unwrap();
        assert_eq!(got, dir.path());
        assert!(mounter.calls.borrow().is_empty());
    }

    #[test]
    fn missing_local_path_is_offline_without_mount_attempt() {
        let mounter = FakeMounter::new(None, false);
        let err = ensure_root_accessible(
            "/definitely/not/there",
            None,
            false,
            &mounter,
            NO_WAIT,
        )
        .unwrap_err();
        assert!(err.contains("不可达") || err.contains("离线"));
        assert!(mounter.calls.borrow().is_empty());
    }

    #[test]
    fn network_root_remounts_when_path_missing() {
        let dir = tempfile::tempdir().unwrap();
        let mount_point = dir.path().join("music");
        let mounter = FakeMounter::new(Some(mount_point.clone()), false);
        let got = ensure_root_accessible(
            mount_point.to_str().unwrap(),
            Some("smb://nas.local/music"),
            true,
            &mounter,
            Duration::from_secs(2),
        )
        .unwrap();
        assert_eq!(got, mount_point);
        let calls = mounter.calls.borrow();
        assert_eq!(calls.len(), 1);
        assert!(calls[0].contains("nas.local") && calls[0].contains("music"));
    }

    #[test]
    fn network_root_mount_failure_reports_offline() {
        let dir = tempfile::tempdir().unwrap();
        let mount_point = dir.path().join("gone");
        let mounter = FakeMounter::new(None, true);
        let err = ensure_root_accessible(
            mount_point.to_str().unwrap(),
            Some("smb://nas.local/music"),
            true,
            &mounter,
            NO_WAIT,
        )
        .unwrap_err();
        assert!(err.contains("离线") || err.contains("挂载"));
    }

    #[test]
    fn network_root_still_missing_after_mount_reports_offline() {
        let dir = tempfile::tempdir().unwrap();
        let mount_point = dir.path().join("gone");
        let mounter = FakeMounter::new(None, false); // 挂载"成功"但路径始终不出现
        let err = ensure_root_accessible(
            mount_point.to_str().unwrap(),
            Some("smb://nas.local/music"),
            true,
            &mounter,
            NO_WAIT,
        )
        .unwrap_err();
        assert!(err.contains("离线") || err.contains("不可达"));
    }
}
