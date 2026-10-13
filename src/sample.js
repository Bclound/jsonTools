export const sample = `{
  "project": "JSON 工作台",
  "version": "1.0.0",
  "description": "把数据看清楚，把工作变简单。",
  "private": true,
  "workspace": {
    "name": "我的工作空间",
    "region": "上海",
    "timezone": "Asia/Shanghai"
  },
  "features": [
    "格式化与校验",
    "树形探索",
    "结构化对比"
  ],
  "members": [
    {
      "id": 1001,
      "name": "林一",
      "role": "developer",
      "active": true
    },
    {
      "id": 1002,
      "name": "陈晨",
      "role": "designer",
      "active": true
    }
  ],
  "settings": {
    "indent": 2,
    "theme": "light",
    "uploadData": false
  },
  "lastUpdated": null
}`;
export const targetSample = sample.replace('"1.0.0"', '"1.1.0"').replace('"region": "上海"', '"region": "杭州"').replace('"role": "designer"', '"role": "developer"').replace('"lastUpdated": null', '"lastUpdated": "2026-10-13",\n  "status": "ready"');
