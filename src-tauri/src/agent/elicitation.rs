//! Bounded, connection-owned structured questions. Answers never grant execution permission.
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::sync::oneshot;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Choice { value: String, label: String, description: String }

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Field {
    key: String, title: String, description: String, kind: String, required: bool,
    options: Vec<Choice>, default: Option<Value>,
    minimum: Option<f64>, maximum: Option<f64>, min_length: usize, max_length: usize,
    min_items: usize, max_items: usize,
    #[serde(skip)]
    pattern: Option<regex::Regex>,
}

#[derive(Clone, Serialize)]
pub struct Form { pub message: String, fields: Vec<Field> }

fn text(value: &Value, key: &str, limit: usize) -> Result<String, String> {
    let text = value.get(key).and_then(Value::as_str).unwrap_or_default();
    if text.len() > limit { return Err("question text exceeds its limit".into()); }
    Ok(text.to_string())
}

fn choices(schema: &Value) -> Result<Vec<Choice>, String> {
    let mut result = Vec::new();
    if let Some(values) = schema.get("enum").and_then(Value::as_array) {
        let names = schema.get("enumNames").and_then(Value::as_array);
        for (index, value) in values.iter().enumerate() {
            let value = value.as_str().ok_or("question choices must be strings")?;
            result.push(Choice { value: value.into(), label: names.and_then(|names| names.get(index)).and_then(Value::as_str).unwrap_or(value).into(), description: String::new() });
        }
    } else if let Some(values) = schema.get("oneOf").or_else(|| schema.get("anyOf")).and_then(Value::as_array) {
        for value in values {
            let id = value.get("const").and_then(Value::as_str).ok_or("question choices must be strings")?;
            result.push(Choice { value: id.into(), label: value.get("title").and_then(Value::as_str).unwrap_or(id).into(), description: text(value, "description", 2048)? });
        }
    }
    if result.len() > 64 || result.iter().any(|choice| choice.value.len() > 4000 || choice.label.len() > 2048) { return Err("too many or oversized question choices".into()); }
    let mut seen = std::collections::HashSet::new();
    if result.iter().any(|choice| !seen.insert(&choice.value)) { return Err("duplicate question choices".into()); }
    Ok(result)
}

pub fn parse(params: &Value) -> Result<Form, String> {
    if params.get("mode").and_then(Value::as_str) != Some("form") { return Err("only form questions are supported".into()); }
    if params.to_string().len() > 65536 { return Err("question exceeds its size limit".into()); }
    let schema = params.get("requestedSchema").ok_or("question schema is missing")?;
    let properties = match schema.get("properties") {
        None => serde_json::Map::new(),
        Some(value) => value.as_object().cloned().ok_or("question fields must be an object")?,
    };
    if properties.len() > 32 { return Err("too many question fields".into()); }
    let required = schema.get("required").and_then(Value::as_array).cloned().unwrap_or_default();
    if required.iter().any(|key| key.as_str().is_none_or(|key| !properties.contains_key(key))) { return Err("unknown required question field".into()); }
    let mut fields = Vec::new();
    for (key, value) in properties {
        if key.len() > 256 || ["__proto__", "constructor", "prototype"].contains(&key.as_str()) { return Err("invalid question field name".into()); }
        let identity: String = key.chars().filter(|letter| letter.is_ascii_alphanumeric()).flat_map(char::to_lowercase).collect();
        if ["password", "apikey", "accesstoken", "refreshtoken", "privatekey", "recoverycode", "creditcard", "cardnumber", "cvv"].contains(&identity.as_str()) { return Err("credentials cannot be requested in a question form".into()); }
        if value.get("writeOnly").and_then(Value::as_bool) == Some(true) || value.get("format").and_then(Value::as_str).is_some_and(|format| ["password", "secret", "token"].contains(&format)) { return Err("credentials cannot be requested in a question form".into()); }
        let kind = value.get("type").and_then(Value::as_str).ok_or("question field type is missing")?;
        if !["string", "number", "integer", "boolean", "array"].contains(&kind) { return Err("unsupported question field type".into()); }
        let options = if kind == "array" { choices(value.get("items").ok_or("multiple-choice items are missing")?)? } else { choices(&value)? };
        if kind == "array" && value.pointer("/items/type").and_then(Value::as_str) != Some("string") { return Err("multiple-choice items must be strings".into()); }
        if kind == "array" && options.is_empty() { return Err("arrays must contain string choices".into()); }
        let min_length = value.get("minLength").and_then(Value::as_u64).unwrap_or(0) as usize;
        let max_length = value.get("maxLength").and_then(Value::as_u64).unwrap_or(4000).min(4000) as usize;
        let min_items = value.get("minItems").and_then(Value::as_u64).unwrap_or(0) as usize;
        let max_items = value.get("maxItems").and_then(Value::as_u64).unwrap_or(64).min(64) as usize;
        let minimum = value.get("minimum").and_then(Value::as_f64);
        let maximum = value.get("maximum").and_then(Value::as_f64);
        if min_length > max_length || min_items > max_items || minimum.zip(maximum).is_some_and(|(min, max)| min > max) { return Err("inconsistent question constraints".into()); }
        let pattern = value.get("pattern").and_then(Value::as_str).map(|pattern| regex::RegexBuilder::new(pattern).size_limit(65536).build()).transpose().map_err(|_| "unsupported question pattern")?;
        let mut field = Field { title: text(&value, "title", 2048)?, description: text(&value, "description", 4096)?,
            required: required.iter().any(|value| value.as_str() == Some(key.as_str())), key,
            kind: kind.into(), options, default: None, minimum, maximum, min_length, max_length, min_items, max_items, pattern };
        if let Some(default) = value.get("default") {
            if valid(&field, default) { field.default = Some(default.clone()); }
        }
        fields.push(field);
    }
    Ok(Form { message: text(params, "message", 8192)?, fields })
}

fn valid(field: &Field, value: &Value) -> bool {
    match field.kind.as_str() {
        "string" => value.as_str().is_some_and(|value| {
            let length = value.chars().count();
            length >= field.min_length && length <= field.max_length
                && (field.options.is_empty() || field.options.iter().any(|choice| choice.value == value))
                && field.pattern.as_ref().is_none_or(|pattern| pattern.is_match(value))
        }),
        "number" | "integer" => value.as_f64().is_some_and(|value| value.is_finite()
            && (field.kind != "integer" || value.fract() == 0.0)
            && field.minimum.is_none_or(|min| value >= min) && field.maximum.is_none_or(|max| value <= max)),
        "boolean" => value.is_boolean(),
        "array" => value.as_array().is_some_and(|values| values.len() >= field.min_items && values.len() <= field.max_items
            && values.iter().enumerate().all(|(index, value)| value.as_str().is_some_and(|value| field.options.iter().any(|choice| choice.value == value)) && !values[..index].contains(value))),
        _ => false,
    }
}

pub fn validate(form: &Form, response: &Value) -> Result<(), String> {
    match response.get("action").and_then(Value::as_str) {
        Some("cancel" | "decline") => Ok(()),
        Some("accept") => {
            let content = response.get("content").and_then(Value::as_object).ok_or("question answers must be an object")?;
            if content.len() > form.fields.len() || content.keys().any(|key| !form.fields.iter().any(|field| &field.key == key)) { return Err("unknown question answer".into()); }
            for field in &form.fields {
                if let Some(value) = content.get(&field.key) { if !valid(field, value) { return Err("invalid question answer".into()); } }
                else if field.required { return Err("required question answer is missing".into()); }
            }
            Ok(())
        },
        _ => Err("invalid question action".into()),
    }
}

struct Pending { form: Form, sender: oneshot::Sender<Value> }
#[derive(Clone, Default)]
pub struct Requests(Arc<Mutex<HashMap<String, Pending>>>);
pub struct RequestGuard { requests: Requests, key: String }
impl Drop for RequestGuard { fn drop(&mut self) { if let Ok(mut map) = self.requests.0.lock() { map.remove(&self.key); } } }
impl Requests {
    pub fn insert(&self, session: &str, id: &str, form: Form) -> Result<(oneshot::Receiver<Value>, RequestGuard), String> {
        let key = format!("{session}::{id}");
        let mut map = self.0.lock().map_err(|_| "question state is poisoned")?;
        if map.len() >= 256 || map.keys().filter(|key| key.starts_with(&format!("{session}::"))).count() >= 8 { return Err("too many pending questions".into()); }
        let (sender, receiver) = oneshot::channel();
        map.insert(key.clone(), Pending { form, sender });
        Ok((receiver, RequestGuard { requests: self.clone(), key }))
    }
    pub fn answer(&self, session: &str, id: &str, response: Value) -> Result<(), String> {
        if response.to_string().len() > 65536 { return Err("question answer exceeds its limit".into()); }
        let key = format!("{session}::{id}");
        let mut map = self.0.lock().map_err(|_| "question state is poisoned")?;
        let request = map.get(&key).ok_or("question is no longer waiting")?;
        validate(&request.form, &response)?;
        let request = map.remove(&key).ok_or("question is no longer waiting")?;
        let response = if response["action"] == "accept" { response } else { json!({ "action": response["action"] }) };
        request.sender.send(response).map_err(|_| "question is no longer waiting".into())
    }
    pub fn cancel(&self, session: &str) {
        if let Ok(mut map) = self.0.lock() { map.retain(|key, _| !key.starts_with(&format!("{session}::"))); }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn form() -> Form { parse(&json!({ "mode":"form", "message":"Choose", "requestedSchema": { "type":"object", "properties": {
        "scope": { "type":"array", "items": { "type":"string", "anyOf":[{"const":"all","title":"All changes"},{"const":"cache"}] }, "minItems":1 },
        "limit": {"type":"integer","minimum":1,"maximum":10}
    }, "required":["scope"] }})).unwrap() }
    #[test]
    fn validates_multiple_choice_and_typed_values() {
        let form = form();
        assert!(validate(&form, &json!({"action":"accept","content":{"scope":["all","cache"],"limit":2}})).is_ok());
        for content in [json!({"scope":["unknown"]}), json!({"scope":["all","all"]}), json!({"scope":[]}), json!({"scope":["all"],"limit":"2"}), json!({"scope":["all"],"limit":11}), json!({"other":true})] {
            assert!(validate(&form, &json!({"action":"accept","content":content})).is_err());
        }
        assert!(validate(&form, &json!({"action":"unknown"})).is_err());
    }
    #[test]
    fn refuses_unsupported_and_sensitive_forms() {
        for schema in [json!({"type":"object"}), json!({"type":"string","format":"password"}), json!({"type":"string","writeOnly":true}), json!({"type":"array","items":{"type":"object"}})] {
            assert!(parse(&json!({"mode":"form","requestedSchema":{"properties":{"x":schema}}})).is_err());
        }
    }
    #[tokio::test]
    async fn isolates_sessions_validates_before_removal_and_rejects_stale_answers() {
        let requests = Requests::default();
        let (receiver, _guard) = requests.insert("one", "id", form()).unwrap();
        assert!(requests.answer("two", "id", json!({"action":"cancel"})).is_err());
        assert!(requests.answer("one", "id", json!({"action":"accept","content":{}})).is_err());
        requests.answer("one", "id", json!({"action":"accept","content":{"scope":["all"]}})).unwrap();
        assert_eq!(receiver.await.unwrap()["content"]["scope"], json!(["all"]));
        assert!(requests.answer("one", "id", json!({"action":"cancel"})).is_err());
        let (receiver, guard) = requests.insert("one", "next", form()).unwrap();
        drop(guard);
        assert!(receiver.await.is_err());
    }
}
