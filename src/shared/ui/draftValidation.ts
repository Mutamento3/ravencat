/** 用户输入只在草稿转换边界校验，提交后的内部参数直接信任类型。 */
export function readDraftNumber(text: string, label: string, min: number, max: number, optional = false) {
  if (optional && text.trim() === '') return { value: null, error: null };
  const value = Number(text);
  if (!text.trim() || !Number.isFinite(value) || value < min || value > max) {
    return { value: null, error: `请输入 ${min}～${max} 之间的${label}；这次修改尚未保存。` };
  }
  return { value, error: null };
}

export function readDraftInteger(text: string, label: string, optional = false) {
  if (optional && text.trim() === '') return { value: null, error: null };
  const value = Number(text);
  if (!text.trim() || !Number.isSafeInteger(value) || value < 1) {
    return { value: null, error: `${label}需要填写正整数；这次修改尚未保存。` };
  }
  return { value, error: null };
}
