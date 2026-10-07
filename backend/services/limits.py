"""Admission limits for the single-process video worker, including disk reservations."""
from dataclasses import dataclass
from datetime import datetime, UTC
from pathlib import Path
import os
import shutil
from fastapi import HTTPException

ACTIVE = {"queued", "running"}

@dataclass(frozen=True)
class VideoLimits:
    active_per_user: int = 2
    active_global: int = 16
    daily_per_user: int = 20
    storage_bytes: int = 2 * 1024**3
    output_bytes: int = 256 * 1024**2
    min_free_bytes: int = 512 * 1024**2

    @classmethod
    def from_env(cls):
        defaults = cls()
        values = {}
        for field in cls.__dataclass_fields__:
            key = 'TDLUXY_VIDEO_' + field.upper()
            value = int(os.environ.get(key, getattr(defaults, field)))
            if value <= 0:
                raise ValueError(f'{key} must be positive')
            values[field] = value
        if values['output_bytes'] > values['storage_bytes']:
            raise ValueError('Video output reservation exceeds user storage quota')
        return cls(**values)

def directory_size(path: Path) -> int:
    if not path.exists():
        return 0
    return sum(p.stat().st_size for p in path.rglob('*') if p.is_file())

def usage(jobs, user_id, output_dir: Path, limits: VideoLimits) -> dict:
    owned = [j for j in jobs if j.user_id == user_id]
    today = datetime.now(UTC).date().isoformat()
    used = sum(directory_size(output_dir / j.id) for j in owned)
    # Active jobs reserve their entire output allowance, including partial files.
    reserved = sum(max(0, j.max_output_bytes - directory_size(output_dir / j.id))
                   for j in owned if j.status in ACTIVE)
    return {"active": sum(j.status in ACTIVE for j in owned),
            "daily": sum(j.created_at[:10] == today for j in owned),
            "used_bytes": used, "reserved_bytes": reserved,
            "active_limit": limits.active_per_user, "daily_limit": limits.daily_per_user,
            "storage_limit_bytes": limits.storage_bytes}

def check_admission(jobs, user_id, output_dir: Path, limits: VideoLimits, *, resume=False, reservation_bytes=None):
    jobs = list(jobs)
    reservation = limits.output_bytes if reservation_bytes is None else reservation_bytes
    current = usage(jobs, user_id, output_dir, limits)
    if current['active'] >= limits.active_per_user:
        raise HTTPException(429, 'Bạn đã có đủ tác vụ đang chờ/chạy. Hãy chờ hoặc hủy tác vụ chưa gửi.', headers={'Retry-After': '10'})
    if sum(j.status in ACTIVE for j in jobs) >= limits.active_global:
        raise HTTPException(429, 'Hàng đợi hệ thống đã đầy. Vui lòng thử lại sau.', headers={'Retry-After': '10'})
    if not resume and current['daily'] >= limits.daily_per_user:
        raise HTTPException(429, 'Bạn đã đạt hạn mức tạo video hôm nay (UTC).')
    if current['used_bytes'] + current['reserved_bytes'] + reservation > limits.storage_bytes:
        raise HTTPException(413, 'Kho video đã đầy hoặc được giữ chỗ cho tác vụ đang chạy. Hãy xóa video cũ trong Lịch sử.')
    output_dir.mkdir(parents=True, exist_ok=True)
    reserved_global = sum(j.max_output_bytes for j in jobs if j.status in ACTIVE)
    if shutil.disk_usage(output_dir).free < limits.min_free_bytes + reserved_global + reservation:
        raise HTTPException(507, 'Máy chủ không còn đủ dung lượng trống để nhận video mới.')
