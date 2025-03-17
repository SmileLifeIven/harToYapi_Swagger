const fs = require('fs');
const args = process.argv.slice(2);

if (args.length === 0) {
  console.error('请提供HAR文件路径，例如: node HarToSwagger.js example.har [output-dir]');
  process.exit(1);
}

const harFilePath = args[0];
const outputPath = args[1] || './swagger-docs';

class HarToSwagger {
  constructor(options = {}) {
    this.options = {
      minItems: 5,
      maxItems: 20,
      ...options
    };
    // 用于存储每个接口的枚举值
    this.enumCache = new Map();
  }

  // 预处理所有接口的枚举值
  preprocessEnums(entries) {
    entries.forEach(entry => {
      const url = new URL(entry.request.url);
      const path = url.pathname;

      try {
        const responseData = JSON.parse(entry.response.content.text);
        this.extractEnums(path, responseData);
      } catch (error) {
        console.warn(`处理接口 ${path} 的枚举值时出错:`, error);
      }
    });
  }

  // 递归提取枚举值
  extractEnums(path, data, parentKey = '') {
    if (!this.enumCache.has(path)) {
      this.enumCache.set(path, new Map());
    }
    const pathEnums = this.enumCache.get(path);

    if (Array.isArray(data)) {
      // 处理数组中的所有元素
      data.forEach(item => {
        if (typeof item === 'object' && item !== null) {
          // 对于数组中的每个对象，都需要提取其属性值
          Object.entries(item).forEach(([key, value]) => {
            if (!pathEnums.has(key)) {
              pathEnums.set(key, new Set());
            }
            pathEnums.get(key).add(value);
          });
          // 递归处理嵌套对象
          this.extractEnums(path, item, parentKey);
        } else {
          // 如果数组元素是基本类型，直接添加到父键的枚举中
          if (!pathEnums.has(parentKey)) {
            pathEnums.set(parentKey, new Set());
          }
          pathEnums.get(parentKey).add(item);
        }
      });
    } else if (typeof data === 'object' && data !== null) {
      // 处理对象的每个属性
      Object.entries(data).forEach(([key, value]) => {
        if (Array.isArray(value)) {
          // 递归处理数组
          this.extractEnums(path, value, key);
        } else if (typeof value === 'object' && value !== null) {
          // 递归处理嵌套对象
          this.extractEnums(path, value, key);
        } else {
          // 处理基本类型值
          if (!pathEnums.has(key)) {
            pathEnums.set(key, new Set());
          }
          pathEnums.get(key).add(value);
        }
      });
    }
  }

  // 生成Schema
  generateSchema(data, parentKey = '', path = '') {
    if (Array.isArray(data)) {
      const itemSchemas = data.map(item => this.generateSchema(item, parentKey, path));
      const mergedSchema = this.mergeSchemas(itemSchemas);

      return {
        type: "array",
        minItems: this.options.minItems,
        maxItems: this.options.maxItems,
        items: mergedSchema
      };
    }

    if (typeof data === 'object' && data !== null) {
      const properties = {};
      const required = [];

      for (const [key, value] of Object.entries(data)) {
        properties[key] = this.generateSchema(value, key, path);
        required.push(key);
      }

      return {
        type: "object",
        required,
        properties
      };
    }

    // 处理基本类型
    const schema = {
      type: this.guessType(data),
    };

    // 根据key名称设置特殊的mock值
    if (parentKey) {
      if (parentKey.toLowerCase().includes('id')) {
        schema.mock = { mock: "@id" };
      } else if (parentKey === 'createdTime' || parentKey === 'updatedTime') {
        schema.mock = { mock: "1740942183000" };
      } else if (parentKey.toLowerCase().includes('domain')) {
        schema.mock = { mock: "@domain" };
      } else if (parentKey === 'name') {
        schema.mock = { mock: "@name" };
      } else if (parentKey.toLowerCase().includes('ip')) {
        schema.mock = { mock: "@ip" };
      } else if (parentKey.toLowerCase().includes('email')) {
        schema.mock = { mock: "@email" };
      } else if (parentKey.toLowerCase().includes('url')) {
        schema.mock = { mock: "@url" };
      } else if (data !== null) {
        schema.mock = { mock: this.convertValue(data) };
      }
    } else if (data !== null) {
      schema.mock = { mock: this.convertValue(data) };
    }

    // 添加枚举值
    const enumValues = this.getEnumValues(path, parentKey, data);
    if (enumValues) {
      schema.enum = enumValues;
    }

    return schema;
  }

  // 合并多个schema
  mergeSchemas(schemas) {
    if (schemas.length === 0) return {};
    if (schemas.length === 1) return schemas[0];

    const firstSchema = schemas[0];
    const mergedSchema = { ...firstSchema };

    // 如果是对象类型，需要合并所有属性
    if (firstSchema.type === 'object' && firstSchema.properties) {
      const allProperties = new Set();
      schemas.forEach(schema => {
        if (schema.properties) {
          Object.keys(schema.properties).forEach(key => allProperties.add(key));
        }
      });

      mergedSchema.properties = {};
      mergedSchema.required = [];

      allProperties.forEach(prop => {
        const propSchemas = schemas
          .filter(schema => schema.properties && schema.properties[prop])
          .map(schema => schema.properties[prop]);

        if (propSchemas.length > 0) {
          mergedSchema.properties[prop] = this.mergeSchemas(propSchemas);
          mergedSchema.required.push(prop);
        }
      });
    }

    // 合并enum值
    const allEnums = new Set();
    schemas.forEach(schema => {
      if (schema.enum) {
        schema.enum.forEach(value => allEnums.add(value));
      }
    });
    if (allEnums.size > 0) {
      mergedSchema.enum = Array.from(allEnums);
    }

    return mergedSchema;
  }

  // 获取特定路径和字段的枚举值
  getEnumValues(path, key, value) {
    // 处理布尔类型
    if (typeof value === 'boolean') {
      return [true, false];
    }

    // 从缓存中获取该路径的枚举值
    const pathEnums = this.enumCache.get(path);
    if (!pathEnums) {
      return null;
    }

    // 获取字段的唯一值
    const enumSet = pathEnums.get(key);
    if (!enumSet) {
      return null;
    }

    // 转换Set为数组
    const enumValues = Array.from(enumSet);

    // 只有当有多个值时才返回枚举
    return enumValues.length > 1 ? enumValues : null;
  }

  // 主转换函数的修改
  convert(harFilePath, outputPath) {
    try {
      const harContent = JSON.parse(fs.readFileSync(harFilePath, 'utf8'));
      const entries = harContent.log.entries;

      // 预处理所有接口的枚举值
      this.preprocessEnums(entries);

      // 按URL分组处理接口
      const apiGroups = this.groupApisByUrl(entries);

      // 生成Swagger文档
      const swaggerDocs = this.generateSwaggerDocs(apiGroups);

      // 保存文件
      this.saveSwaggerDocs(harFilePath, swaggerDocs, outputPath);

      console.log('转换完成!');
    } catch (error) {
      console.error('转换失败:', error);
    }
  }

  // 按URL分组API
  groupApisByUrl(entries) {
    const groups = {};

    entries.forEach(entry => {
      const url = new URL(entry.request.url);
      let path = url.pathname;
      // 转换转义后的 %7B$var%7D 为 :$var 格式
      path = path.replace(/%7B(\w+)%7D/g, '{$1}');
      if (!groups[path]) {
        groups[path] = [];
      }
      groups[path].push(entry);
    });

    return groups;
  }

  // 生成Swagger文档
  generateSwaggerDocs(apiGroups) {
    const swaggerDocs = {};

    for (const [path, entries] of Object.entries(apiGroups)) {
      const apiName = this.getApiName(path);
      const urlPrefix = path.split('/')[3]; // 获取URL前缀的第一个单词
      const tags = [urlPrefix]; // 创建tags数组

      swaggerDocs[apiName] = {
        swagger: "2.0",
        info: {
          title: `${apiName} API`,
          version: "1.0.0",
          description: `${apiName}相关接口文档`
        },
        host: "192.168.1.1:9600",
        basePath: "/",
        schemes: ["http"],
        tags: tags, // 添加tags到文档
        paths: {
          [path]: this.generatePathItem(entries[0], path, tags) // 传递tags
        }
      };
    }

    // 在生成文档后，去除所有接口的status枚举
    for (const doc of Object.values(swaggerDocs)) {
      for (const pathItem of Object.values(doc.paths)) {
        if (pathItem.get && pathItem.get.responses) {
          this.removeStatusEnum(pathItem.get.responses);
        }
        if (pathItem.post && pathItem.post.responses) {
          this.removeStatusEnum(pathItem.post.responses);
        }
        // 根据需要处理其他HTTP方法
      }
    }

    return swaggerDocs;
  }

  // 移除status的枚举
  removeStatusEnum(responses) {
    for (const response of Object.values(responses)) {
      if (response.schema && response.schema.properties && response.schema.properties.status) {
        delete response.schema.properties.status.enum; // 移除status的枚举
      }
    }
  }

  // 生成路径项
  generatePathItem(entry, path, tags) {
    const method = entry.request.method.toLowerCase();
    const parameters = this.generateParameters(entry.request);
    const responses = this.generateResponses(entry.response, path);

    return {
      [method]: {
        summary: this.generateSummary(entry),
        tags: tags, // 添加tags到每个请求方法
        produces: ["application/json"],
        parameters,
        responses
      }
    };
  }

  // 生成请求参数
  generateParameters(request) {
    const parameters = [];

    // 处理查询参数
    if (request.queryString) {
      request.queryString.forEach(query => {
        parameters.push({
          name: query.name,
          in: "query",
          type: this.guessType(query.value),
          required: true,
          description: `${query.name}参数`,
          mock: {
            mock: this.convertValue(query.value)
          }
        });
      });
    }

    return parameters;
  }

  // 生成响应
  generateResponses(response, path) {
    const content = JSON.parse(response.content.text);

    // 处理响应，确保status固定为success
    this.processResponse(content); // 调用processResponse方法

    return {
      "default": {
        description: "成功返回数据",
        schema: this.generateSchema(content, '', path)
      }
    };
  }

  // 推测数据类型
  guessType(value) {
    if (value === null) return 'null';
    if (typeof value === 'boolean') return 'boolean';
    if (typeof value === 'number') {
      return Number.isInteger(value) ? 'integer' : 'number';
    }
    return 'string';
  }

  // 转换值(处理null)
  convertValue(value) {
    return value === null ? "null" : value;
  }

  // 获取API名称
  getApiName(path) {
    const parts = path.split('/');
    return parts[parts.length - 1] || 'api';
  }

  // 生成接口描述
  generateSummary(entry) {
    const path = new URL(entry.request.url).pathname;
    const method = entry.request.method;
    return `${method} ${path}`;
  }

  // 保存Swagger文档
  saveSwaggerDocs(harFilePath, swaggerDocs, outputPath) {
    if (!fs.existsSync(outputPath)) {
      fs.mkdirSync(outputPath, { recursive: true });
    }

    const mergedDoc = {
      swagger: "2.0",
      info: {
        title: "合并API文档",
        version: "1.0.0",
        description: "合并后的Swagger API文档"
      },
      host: "192.168.1.1:9600",
      basePath: "/",
      schemes: ["http"],
      paths: {},
      tags: [] // 新增：初始化tags数组
    };

    for (const [name, doc] of Object.entries(swaggerDocs)) {
      // 合并每个文档的路径
      Object.assign(mergedDoc.paths, doc.paths);

      // 合并tags，确保不重复
      if (doc.tags) {
        for (const tag of doc.tags) {
          if (!mergedDoc.tags.some(existingTag => existingTag.name === tag)) {
            mergedDoc.tags.push({ name: tag }); // 新增：将tag添加到mergedDoc中
          }
        }
      }
    }

    const filename = harFilePath.split('.har')


    const filePath = `${outputPath}/${filename[0]}.json`;
    fs.writeFileSync(filePath, JSON.stringify(mergedDoc, null, 2));
    console.log(`已生成: ${filePath}`);
  }

  // 处理响应
  processResponse(response) {
    response.status = "success"; // 新增：固定每个接口的status为success
    // 移除枚举处理逻辑
    if (response.properties && response.properties.status) {
      delete response.properties.status.enum; // 新增：移除status的枚举
    }
  }
}

const converter = new HarToSwagger({
    minItems: 5,
    maxItems: 20
  });

  // HAR文件将被解析，自动提取所有可能的枚举值
  converter.convert(harFilePath, outputPath);