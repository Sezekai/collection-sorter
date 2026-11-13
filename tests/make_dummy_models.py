import numpy as np, onnx, sys, os
from onnx import helper as h, TensorProto as T, numpy_helper as nh
out = sys.argv[1]; os.makedirs(out + '/wd14', exist_ok=True); os.makedirs(out + '/clip', exist_ok=True)
rng = np.random.default_rng(1)
def init(n, a): return nh.from_array(a.astype(np.float32), n)
def save(g, path):
    m = h.make_model(g, opset_imports=[h.make_opsetid('', 13)]); m.ir_version = 8; onnx.save(m, path)
# tags: 4 ratings, 6 general, 3 character
tags = [('general',9),('sensitive',9),('questionable',9),('explicit',9)] + [(t,0) for t in ['1girl','monochrome','greyscale','sword','outdoors','smile']] + [('rem (re:zero)',4),('eren yeager',4),('link (zelda)',4)]
open(out + '/wd14/selected_tags.csv', 'w').write('tag_id,name,category,count\n' + ''.join(f'{i},{n},{c},100\n' for i, (n, c) in enumerate(tags)))
K = len(tags)
g = h.make_graph([
    h.make_node('ReduceMean', ['x'], ['m'], axes=[1, 2], keepdims=0),
    h.make_node('MatMul', ['m', 'W'], ['z']),
    h.make_node('Sigmoid', ['z'], ['y'])], 'wd',
    [h.make_tensor_value_info('x', T.FLOAT, ['N', 448, 448, 3])], [h.make_tensor_value_info('y', T.FLOAT, ['N', K])],
    [init('W', rng.normal(size=(3, K)) * 0.05)])
save(g, out + '/wd14/model.onnx')
g = h.make_graph([
    h.make_node('ReduceMean', ['pixel_values'], ['m'], axes=[2, 3], keepdims=0),
    h.make_node('MatMul', ['m', 'W'], ['image_embeds'])], 'cv',
    [h.make_tensor_value_info('pixel_values', T.FLOAT, ['N', 3, 224, 224])], [h.make_tensor_value_info('image_embeds', T.FLOAT, ['N', 512])],
    [init('W', rng.normal(size=(3, 512)))])
save(g, out + '/clip/vision_model.onnx')
g = h.make_graph([
    h.make_node('Cast', ['input_ids'], ['f'], to=T.FLOAT),
    h.make_node('MatMul', ['f', 'W'], ['text_embeds'])], 'ct',
    [h.make_tensor_value_info('input_ids', T.INT64, ['N', 77])], [h.make_tensor_value_info('text_embeds', T.FLOAT, ['N', 512])],
    [init('W', rng.normal(size=(77, 512)) * 0.01)])
save(g, out + '/clip/text_model.onnx')
# JoyTag stand-in: NCHW input, logits out, plain tag list
os.makedirs(out + '/joytag', exist_ok=True)
jt = ['1girl','solo','photorealistic','photo','realistic','smile','outdoors','sword','monochrome','blue hair','long hair','sky','looking at viewer','breasts','nude','city','tree','dress','weapon','building']
open(out + '/joytag/top_tags.txt', 'w').write('\n'.join(jt) + '\n')
KJ = len(jt); W = rng.normal(size=(3, KJ)) * 3.0; b = -2.0 * np.ones(KJ)
g = h.make_graph([
    h.make_node('ReduceMean', ['image'], ['m'], axes=[2, 3], keepdims=0),
    h.make_node('MatMul', ['m', 'W'], ['z0']),
    h.make_node('Add', ['z0', 'b'], ['tags'])], 'jt',
    [h.make_tensor_value_info('image', T.FLOAT, ['N', 3, 448, 448])], [h.make_tensor_value_info('tags', T.FLOAT, ['N', KJ])],
    [init('W', W), init('b', b)])
save(g, out + '/joytag/model.onnx')
print('ok')
