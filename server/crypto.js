// 凭证加密:API Key 等敏感数据入库前加密,读取时解密
// 算法:AES-256-GCM(认证加密,防篡改)
// 主密钥来源(优先级):
//   1. 环境变量 INTERVIEWX_MASTER_KEY(64 位 hex,32 字节)
//   2. 本地文件 data/.master_key(自动生成,权限 0600)
// 注意:加密后的密文格式为 base64(iv:ciphertext:tag),便于存储在 TEXT 字段
import crypto from "crypto";
import fs from "fs";
import path from "path";

const KEY_FILE = path.join(process.env.DB_DIR || process.cwd(), ".master_key");
const ALGO = "aes-256-gcm";
const IV_LEN = 12; // GCM 推荐 12 字节 IV

let masterKey = null;

function loadMasterKey() {
  if (masterKey) return masterKey;
  // v10:生产环境强制 fail-fast,防止降级到进程内随机密钥导致重启后密文丢失
  const isProd = process.env.NODE_ENV === "production";
  // 1. 环境变量优先
  const envKey = process.env.INTERVIEWX_MASTER_KEY;
  if (envKey) {
    if (!/^[0-9a-fA-F]{64}$/.test(envKey)) {
      throw new Error("INTERVIEWX_MASTER_KEY 必须是 64 位 hex 字符串(32 字节)");
    }
    console.warn("[crypto] 主密钥来源:INTERVIEWX_MASTER_KEY 环境变量");
    masterKey = Buffer.from(envKey, "hex");
    return masterKey;
  }
  // 2. 本地文件
  if (fs.existsSync(KEY_FILE)) {
    try {
      const raw = fs.readFileSync(KEY_FILE, "utf-8").trim();
      if (/^[0-9a-fA-F]{64}$/.test(raw)) {
        console.warn(`[crypto] 主密钥来源:文件 ${KEY_FILE}`);
        masterKey = Buffer.from(raw, "hex");
        return masterKey;
      }
      console.warn(`[crypto] 主密钥文件 ${KEY_FILE} 内容格式无效,将重新生成`);
    } catch (e) {
      console.warn(`[crypto] 读取主密钥文件失败:${e.message},将重新生成`);
    }
  }
  // 3. 生成新密钥并写入文件(失败则:生产环境抛错退出;开发环境降级到内存随机密钥)
  const newKey = crypto.randomBytes(32);
  try {
    fs.writeFileSync(KEY_FILE, newKey.toString("hex"), { mode: 0o600 });
    console.warn(`[crypto] 主密钥来源:新生成并写入 ${KEY_FILE}(请妥善备份,丢失则历史密文不可解密)`);
    masterKey = newKey;
    return masterKey;
  } catch (e) {
    if (isProd) {
      // 生产环境:文件不可写(只读文件系统/权限问题)直接抛错退出,不静默降级
      console.error(`[crypto] 生产环境无法持久化主密钥:${e.message}`);
      throw new Error(`生产环境必须持久化主密钥,但写入 ${KEY_FILE} 失败:${e.message}`);
    }
    // 开发环境:降级到内存随机密钥(重启后旧密文不可解密,仅作开发兜底)
    console.warn(`[crypto] 无法持久化主密钥(${e.message}),使用进程内随机密钥(仅适合开发,重启后旧密文不可解密)`);
    masterKey = newKey;
    return masterKey;
  }
}

// 加密:返回 base64(iv:ciphertext:tag),失败返回 null(不抛错,避免阻塞业务)
export function encryptSecret(plain) {
  if (plain == null || plain === "") return null;
  if (typeof plain !== "string") plain = String(plain);
  // 已加密标识:ENC:: 前缀,避免重复加密
  if (plain.startsWith("ENC::")) return plain;
  try {
    const key = loadMasterKey();
    const iv = crypto.randomBytes(IV_LEN);
    const cipher = crypto.createCipheriv(ALGO, key, iv);
    const ct = Buffer.concat([cipher.update(plain, "utf-8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return "ENC::" + Buffer.concat([iv, ct, tag]).toString("base64");
  } catch (e) {
    console.error(`[crypto] 加密失败:${e.message}`);
    return null;
  }
}

// 解密:接受 ENC:: 前缀的密文,无前缀视为未加密(向后兼容已有明文)
export function decryptSecret(stored) {
  if (!stored || typeof stored !== "string") return stored;
  if (!stored.startsWith("ENC::")) return stored; // 兼容旧明文
  try {
    const key = loadMasterKey();
    const buf = Buffer.from(stored.slice(5), "base64");
    const iv = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(buf.length - 16);
    const ct = buf.subarray(IV_LEN, buf.length - 16);
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ct), decipher.final()]);
    return plain.toString("utf-8");
  } catch (e) {
    // 解密失败(密钥不匹配/数据损坏):返回 null,调用方应处理
    console.error(`[crypto] 解密失败:${e.message}`);
    return null;
  }
}

// 判断是否已加密(供迁移逻辑使用)
export function isEncrypted(stored) {
  return typeof stored === "string" && stored.startsWith("ENC::");
}
