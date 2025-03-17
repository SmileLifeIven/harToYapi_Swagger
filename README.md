# HAR to Swagger Converter

一个将 HAR (HTTP Archive) 文件转换为 Swagger/OpenAPI 文档的工具。

## 功能特点

- 支持将 HAR 文件转换为 Swagger 2.0 格式
- 自动生成 API 文档结构
- 支持自定义 mock 数据规则
- 自动识别请求/响应参数类型

## 使用方法

### 1. 获取 HAR 文件

首先需要从浏览器获取 HAR 文件：

1. 打开 Chrome 浏览器
2. 按 F12 打开开发者工具
3. 切换到 Network 标签页
4. 确保选中了 "Preserve log" 选项
5. 在页面上进行需要记录的操作
6. 右键点击请求列表，选择 "Save all as HAR with content"
7. 保存文件为 `.har` 格式

### 2. 运行转换工具

```bash
node HarToSwagger.js example.har ./my-swagger-docs
```

## Mock 数据规则

工具会根据字段名自动生成对应的 mock 数据：

- 包含 "id" 的字段：`@id`
- 包含 "url" 的字段：`@url`
- 包含 "email" 的字段：`@email`
- 包含 "ip" 的字段：`@ip`
- 字段名为 "name"：`@name`
- 包含 "domain" 的字段：`@domain`
- createdTime/updatedTime：`1740942183000`

## 输出示例

```json
{
  "swagger": "2.0",
  "info": {
    "title": "API Documentation",
    "version": "1.0.0"
  },
  "paths": {
    "/api/example": {
      "get": {
        "responses": {
          "200": {
            "description": "Success",
            "schema": {
              "type": "object",
              "properties": {
                "id": {
                  "type": "string",
                  "mock": {
                    "mock": "@id"
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
```

## 注意事项

1. 确保 HAR 文件包含完整的请求和响应内容
2. 建议在记录 HAR 时清空浏览器缓存
3. 如果 API 需要认证，请确保在记录 HAR 时已经登录
4. 建议按功能模块分别记录 HAR 文件，便于管理和转换

## 常见问题

1. **为什么某些请求没有被转换？**
   - 检查请求是否包含完整的响应数据
   - 确认请求的 Content-Type 是否为 application/json

2. **如何处理带认证的 API？**
   - 在记录 HAR 时确保已经登录
   - 认证信息会自动包含在请求头中

3. **如何自定义 mock 规则？**
   - 可以修改源码中的 `generateSchema` 方法
   - 根据需要添加新的字段匹配规则

## 贡献

欢迎提交 Issue 和 Pull Request！

## 许可

MIT License
