# 网络根通过 OS 挂载接入,而非内置协议客户端

新增网络根(SMB)时,不实现应用内协议客户端,而是调用操作系统挂载(macOS `open smb://`、Windows `net use`、Linux `gio mount`),把远端共享变成本地路径后复用现有 `scan_directory` 全链路。`library_roots` 增加 `source_uri` 与 `is_network` 字段以支持自动重挂与离线态标记。

## Considered Options

- **Rust 内置 WebDAV/SMB 客户端**:WebDAV 可行(HTTP+XML)但需为 lofty 抽象 seekable 虚拟文件层,且标签写回在 HTTP PUT 语义下等于整文件重传,丧失"毫秒级原地更新"卖点;SMB2/3 为复杂二进制协议,纯 Rust crate 尚不成熟,自行实现不现实。
- **同步镜像到本地缓存**:重复占用磁盘,且引入双向同步复杂度,与"工作站直改文件"的定位冲突。
- **OS 挂载(已采纳)**:SMB 是桌面 OS 一等公民,挂载后对 WalkDir/lofty/tag 写回/`convertFileSrc` 播放/目录重整完全透明;凭据由 OS 钥匙串托管,应用不接触密码。代价是依赖系统挂载状态——以 `source_uri` 自动重挂 + Offline Root 语义兜底。

## Consequences

- v1 网络根不做写操作特殊防护(写均经暂存队列由用户显式提交),但 `is_network` 标记落库,日后加防护无需迁移。
- 挂载是 share 级、扫描边界是用户指定的子路径,两者分开记录。
- 浏览器 fallback 模式不提供网络共享入口(无法挂载);已挂载路径可手动添加,行为同本地根。
- WebDAV 若将来支持,走 Rust 内置客户端路线,与 OS 挂载路线并存,不共享抽象。
