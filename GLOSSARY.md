# AWuse

面向无损曲库管理的桌面音频元数据工作站。领域围绕「挂载目录 → 扫描建索引 → 暂存修改 → 原子落盘」展开。

## Language

**Workspace Mode (工作区模式)**:
曲目存在的上下文,分为 Media Library Mode 与 Staging Workspace 两种。

**Media Library Mode (媒体库模式)**:
常驻曲库工作流,挂载 Library Root 后建立持久索引长期管理。

**Staging Workspace (暂存工作区)**:
临时沙盒工作流,用于清洗新下载的专辑包后归档入库,不留持久根。
_Avoid_: 临时库、草稿区

**Library Root (媒体库根)**:
媒体库模式下一次挂载的顶层目录,是扫描、索引与移除的边界单位。按来源分为 Local Root 与 Network Root。

**Local Root (本地根)**:
来源为本机文件系统目录的 Library Root。

**Network Root (网络根)**:
来源为远端共享(如 SMB)、经操作系统挂载后访问的 Library Root。目录内容对应用层与普通路径一致,但可能离线。
_Avoid_: 远程根、云端目录

**Source URI (源 URI)**:
一个 Library Root 的原始地址。Local Root 即其目录路径;Network Root 是远端共享地址(如 `smb://server/share/subdir`),用于挂载失效后恢复访问。

**Mount Point (挂载点)**:
操作系统为远端共享提供的本地访问路径(如 `/Volumes/share`)。Network Root 的曲目路径以它为前缀,可能因重启、断网而失效。

**Offline Root (离线根)**:
Mount Point 不可达且自动重挂失败的 Network Root。其曲目索引保留但不可播放、不可编辑,而非从库中删除。

**Staged Changes Queue (暂存队列)**:
高风险批量修改先进入的内存队列,用户显式提交后才落盘并生成可回滚的事务快照。
_Avoid_: 待办队列、缓冲区
