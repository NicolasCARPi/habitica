import axios from 'axios';
import Vue from 'vue';
import compact from 'lodash/compact';
import omit from 'lodash/omit';
import { loadAsyncResource } from '@/libs/asyncResource';
import * as Analytics from '@/libs/analytics';
import { CONSTANTS, getLocalSetting, setLocalSetting } from '@/libs/userlocalManager';

export function fetchUserTasks (store, options = {}) {
  return loadAsyncResource({
    store,
    path: 'tasks',
    url: '/api/v4/tasks/user',
    deserialize (response) {
      // Wait for the user to be loaded before deserializing
      // because user.tasksOrder is necessary
      return store.dispatch('user:fetch').then(userResource => store.dispatch('tasks:order', [response.data.data, userResource.data.tasksOrder]));
    },
    forceLoad: options.forceLoad,
  });
}

export async function fetchCompletedTodos (store) {
  // Wait for the user to be loaded before deserializing
  // because user.tasksOrder is necessary
  await store.dispatch('tasks:fetchUserTasks');

  const loadStatus = store.state.completedTodosStatus;
  if (loadStatus !== 'LOADING') {
    store.state.completedTodosStatus = 'LOADING';

    const response = await axios.get('/api/v4/tasks/user?type=completedTodos');
    const completedTodos = response.data.data;
    const tasks = store.state.tasks.data;
    // Remove existing completed todos
    tasks.todos = tasks.todos.filter(t => !t.completed);
    tasks.todos.push(...completedTodos);

    store.state.completedTodosStatus = 'LOADED';
  }
}

export async function clearCompletedTodos (store) {
  await axios.post('/api/v4/tasks/clearCompletedTodos');
  store.state.tasks.data.todos = store.state.tasks.data.todos.filter(task => !task.completed);
}

export function order (store, [rawTasks, tasksOrder]) {
  const tasks = {
    habits: [],
    dailys: [],
    todos: [],
    rewards: [],
  };

  rawTasks.forEach(task => {
    tasks[`${task.type}s`].push(task);
  });

  Object.keys(tasks).forEach(type => {
    const tasksOfType = tasks[type];

    const orderOfType = tasksOrder[type];
    const orderedTasks = new Array(tasksOfType.length);
    const unorderedTasks = []; // what we want to add later

    tasksOfType.forEach((task, index) => {
      const taskId = task._id;
      const i = orderOfType[index] === taskId ? index : orderOfType.indexOf(taskId);
      if (i === -1) {
        unorderedTasks.push(task);
      } else {
        orderedTasks[i] = task;
      }
    });

    tasks[type] = compact(orderedTasks).concat(unorderedTasks);
  });

  return tasks;
}

function sanitizeChecklist (task) {
  if (task.checklist) {
    task.checklist = task.checklist.filter(i => Boolean(i.text));
  }
}

// Supply an array to create multiple tasks
export async function create (store, createdTask) {
  // Treat all create actions as if we are adding multiple tasks
  const payload = Array.isArray(createdTask) ? createdTask : [createdTask];

  payload.forEach(t => {
    const type = `${t.type}s`;
    const list = store.state.tasks.data[type];

    sanitizeChecklist(t);

    list.unshift(t);
    store.state.user.data.tasksOrder[type].unshift(t._id);
  });

  const response = await axios.post('/api/v4/tasks/user', payload);
  const data = Array.isArray(response.data.data) ? response.data.data : [response.data.data];

  data.forEach(taskRes => {
    const tasksArr = store.state.tasks.data[`${taskRes.type}s`];
    const taskDataIndex = tasksArr.findIndex(t => t._id === taskRes._id);
    if (taskDataIndex !== -1) {
      Vue.set(tasksArr, taskDataIndex, { ...tasksArr[taskDataIndex], ...taskRes });
    }
    const tasksCreatedCount = getLocalSetting(CONSTANTS.keyConstants.TASKS_CREATED_COUNT);
    if (!tasksCreatedCount || tasksCreatedCount < 2) {
      const uuid = store.state.user.data._id;
      Analytics.track('task created', {
        uuid,
        hitType: 'event',
        category: 'behavior',
        taskType: taskRes.type,
      });
      if (!tasksCreatedCount) {
        setLocalSetting(CONSTANTS.keyConstants.TASKS_CREATED_COUNT, 1);
      } else {
        setLocalSetting(CONSTANTS.keyConstants.TASKS_CREATED_COUNT, tasksCreatedCount + 1);
      }
    }
  });
}

export async function save (store, editedTask) {
  const taskId = editedTask._id;
  const { type } = editedTask;
  const originalTask = store.state.tasks.data[`${type}s`].find(t => t._id === taskId);

  sanitizeChecklist(editedTask);

  if (originalTask) Object.assign(originalTask, editedTask);

  const taskDataToSend = omit(editedTask, ['history']);
  const response = await axios.put(`/api/v4/tasks/${taskId}`, taskDataToSend);
  if (originalTask) Object.assign(originalTask, response.data.data);
}

export async function score (store, { taskId, direction }) {
  const res = await axios.post(`/api/v4/tasks/${taskId}/score/${direction}`);
  return res;
}

// params must be an array of objects with this format
// [ {id: task1Id, direction: task1Direction } , {id: task2Id, direction: task2Direction } ]
export async function bulkScore (store, params) {
  const res = await axios.post('/api/v4/tasks/bulk-score', params);
  return res;
}

export async function scoreChecklistItem (store, { taskId, itemId }) {
  await axios.post(`/api/v4/tasks/${taskId}/checklist/${itemId}/score`);
}

export async function collapseChecklist (store, task) {
  task.collapseChecklist = !task.collapseChecklist;
  await axios.put(`/api/v4/tasks/${task._id}`, {
    collapseChecklist: task.collapseChecklist,
  });
}

export async function destroy (store, task) {
  const list = store.state.tasks.data[`${task.type}s`];
  const taskIndex = list.findIndex(t => t._id === task._id);

  if (taskIndex > -1) {
    list.splice(taskIndex, 1);
  }

  await axios.delete(`/api/v4/tasks/${task._id}`);
}

export async function getChallengeTasks (store, payload) {
  const response = await axios.get(`/api/v4/tasks/challenge/${payload.challengeId}`);
  return response.data.data;
}

export async function createChallengeTasks (store, payload) {
  const response = await axios.post(`/api/v4/tasks/challenge/${payload.challengeId}`, payload.tasks);
  return response.data.data;
}

export async function getGroupTasks (store, payload) {
  const response = await axios.get(`/api/v4/tasks/group/${payload.groupId}`);
  return response.data.data;
}

export async function getCompletedGroupTasks (store, payload) {
  const response = await axios.get(`/api/v4/tasks/group/${payload.groupId}?type=completedTodos`);
  return response.data.data;
}

export async function createGroupTasks (store, payload) {
  const response = await axios.post(`/api/v4/tasks/group/${payload.groupId}`, payload.tasks);
  return response.data.data;
}

export async function assignTask (store, payload) {
  const response = await axios.post(`/api/v4/tasks/${payload.taskId}/assign/${payload.userId}`);
  return response.data.data;
}

export async function unassignTask (store, payload) {
  const response = await axios.post(`/api/v4/tasks/${payload.taskId}/unassign/${payload.userId}`);
  return response.data.data;
}

export async function needsWork (store, payload) {
  const response = await axios.post(`/api/v4/tasks/${payload.taskId}/needs-work/${payload.userId}`);
  return response.data.data;
}

export async function getGroupApprovals (store, payload) {
  const response = await axios.get(`/api/v4/approvals/group/${payload.groupId}`);
  return response.data.data;
}

export async function approve (store, payload) {
  const response = await axios.post(`/api/v4/tasks/${payload.taskId}/approve/${payload.userId}`);
  return response.data.data;
}

export async function unlinkOneTask (store, payload) {
  if (!payload.keep) payload.keep = 'keep';

  const { task } = payload;
  const list = store.state.tasks.data[`${task.type}s`];
  const taskIndex = list.findIndex(t => t._id === task._id);

  if (taskIndex > -1) {
    list.splice(taskIndex, 1);
  }

  const response = await axios.post(`/api/v4/tasks/unlink-one/${payload.task._id}?keep=${payload.keep}`);
  return response.data.data;
}

export async function unlinkAllTasks (store, payload) {
  if (!payload.keep) payload.keep = 'keep-all';
  const response = await axios.post(`/api/v4/tasks/unlink-all/${payload.challengeId}?keep=${payload.keep}`);
  return response.data.data;
}

export async function move (store, payload) {
  const response = await axios.post(`/api/v4/tasks/${payload.taskId}/move/to/${payload.position}`);
  return response.data.data;
}

export async function moveGroupTask (store, payload) {
  const response = await axios.post(`/api/v4/group-tasks/${payload.taskId}/move/to/${payload.position}`);
  return response.data.data;
}
