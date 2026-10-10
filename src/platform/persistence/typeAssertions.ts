/**
 * @fileoverview 持久化平台基础导出类型断言入口
 *
 * 目的：校验公共出口只暴露协调器，不重新暴露原始连接。
 */

import * as storageIndex from './index';
import type { DatabaseCoordinator } from './runtime';

const _databaseCoordinator: DatabaseCoordinator = storageIndex.databaseCoordinator;

void _databaseCoordinator;
