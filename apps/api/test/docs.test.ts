/**
 * OpenAPI document and Swagger UI (SPEC.md §9 "Push, export, health, docs").
 */
import { expect } from 'chai';
import request from 'supertest';
import { useTestApp } from './helpers/testApp';
import { buildOpenApiDocument, docsEnabled } from '../src/http/openapi';

describe('/api/docs', () => {
  const harness = useTestApp();

  it('serves the generated OpenAPI 3.1 document', async () => {
    const res = await request(harness().app).get('/api/docs.json').expect(200);

    expect(res.body.openapi).to.equal('3.1.0');
    expect(res.body.paths).to.have.property('/api/health');
    expect(res.body.components.schemas).to.have.property('ApiError');
  });

  it('serves Swagger UI', async () => {
    const res = await request(harness().app).get('/api/docs/').expect(200);
    expect(res.text).to.include('swagger-ui');
  });

  it('is disabled in production unless DOCS_ENABLED is set', () => {
    expect(docsEnabled({ NODE_ENV: 'production', DOCS_ENABLED: false })).to.equal(false);
    expect(docsEnabled({ NODE_ENV: 'production', DOCS_ENABLED: true })).to.equal(true);
    expect(docsEnabled({ NODE_ENV: 'development', DOCS_ENABLED: false })).to.equal(true);
  });

  it('documents the health response schema', () => {
    const document = buildOpenApiDocument({ APP_URL: 'http://localhost:5173' });
    const health = document.paths?.['/api/health']?.get;
    expect(health?.responses?.['200']).to.be.an('object');
    expect(health?.responses?.['503']).to.be.an('object');
  });
});
