// (C) Copyright 2015 Martin Dougiamas
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

angular.module('mm.addons.mod_assign')

/**
 * Assign index controller.
 *
 * @module mm.addons.mod_assign
 * @ngdoc controller
 * @name mmaModAssignIndexCtrl
 */
.controller('mmaModAssignIndexCtrl', function($scope, $stateParams, $mmaModAssign, $mmUtil, $mmCoursePrefetchDelegate, $translate, $mmCourseHelper, mmaModAssignComponent, $q,
        $state, mmaModAssignSubmissionInvalidatedEvent, $mmEvents, $mmSite, mmaModAssignSubmissionSavedEvent,
        mmaModAssignSubmittedForGradingEvent, $mmCourse, $mmApp, $mmaModAssignSync, $mmText, mmaModAssignEventAutomSynced,
        mmCoreEventOnlineStatusChanged, $mmaModAssignOffline, $ionicScrollDelegate, mmaModAssignEventManualSynced,
        mmaModAssignSubmissionStatusSubmitted, mmaModAssignSubmissionStatusDraft, mmaModAssignNeedGrading) {
    var module = $stateParams.module || {},
        courseId = $stateParams.courseid,
        siteId = $mmSite.getId(),
        userId = $mmSite.getUserId(),
        scrollView, obsSaved, obsSubmitted, syncObserver, onlineObserver;

    $scope.title = module.name;
    $scope.description = module.description;
    $scope.assignComponent = mmaModAssignComponent;
    $scope.moduleUrl = module.url;
    $scope.courseid = courseId;
    $scope.moduleid = module.id;
    $scope.refreshIcon = 'spinner';
    $scope.syncIcon = 'spinner';
    $scope.moduleName = $mmCourse.translateModuleName('assign');
    $scope.mmaModAssignSubmissionStatusSubmitted = mmaModAssignSubmissionStatusSubmitted;
    $scope.mmaModAssignSubmissionStatusDraft = mmaModAssignSubmissionStatusDraft;
    $scope.mmaModAssignNeedGrading = mmaModAssignNeedGrading;

    //var moduleInfo = $mmCourseHelper.getModulePrefetchInfo(module, courseId);
    //$scope.size = moduleInfo.size > 0 ? moduleInfo.sizeReadable : 0;
    //$scope.prefetchStatusIcon = moduleInfo.statusIcon;
    //$scope.timemodified = moduleInfo.timemodified > 0 ? $translate.instant('mm.core.lastmodified') + ': ' + moduleInfo.timemodifiedReadable : "";


    // Check if submit through app is supported.
    $mmaModAssign.isSaveAndSubmitSupported().then(function(enabled) {
        $scope.submitSupported = enabled;
    });

    $scope.gotoSubmissionList = function(status, count) {
        if (typeof status == 'undefined') {
            $state.go('site.mod_assign-submission-list', {courseid: courseId, moduleid: module.id, modulename: module.name});
        } else if (count) {
            $state.go('site.mod_assign-submission-list', {status: status, courseid: courseId, moduleid: module.id, modulename: module.name});
        }
    };

    function fetchAssignment(refresh, sync, showErrors) {
        $scope.isOnline = $mmApp.isOnline();

        var assign;

        // Get assignment data.
        return $mmaModAssign.getAssignment(courseId, module.id).then(function(assignData) {
            assign = assignData;

            $scope.title = assign.name || $scope.title;
            $scope.description = assign.intro ||  $scope.description;
            $scope.assign = assign;

            if (sync) {
                // Try to synchronize the assign.
                return syncAssign(showErrors).catch(function() {
                    // Ignore errors.
                });
            }
        }).then(function() {
          fillContextMenu(module, courseId);
        }).then(function() {
            // Check if there's any offline data for this assign.
            return $mmaModAssignOffline.getAssignSubmissions(assign.id).catch(function() {
                // No offline data found.
                return [];
            });
        }).then(function(submissions) {
            $scope.hasOffline = submissions.length;

            // Get assignment submissions.
            return $mmaModAssign.getSubmissions(assign.id).then(function(data) {
                var time = parseInt(Date.now() / 1000);

                $scope.canviewsubmissions = data.canviewsubmissions;
                if (data.canviewsubmissions) {
                    // We want to show the user data on each submission.

                    if (assign.duedate > 0) {
                        if (assign.duedate - time <= 0) {
                            $scope.timeRemaining = $translate.instant('mma.mod_assign.assignmentisdue');
                        } else {
                            $scope.timeRemaining = $mmUtil.formatDuration(assign.duedate - time, 3);
                            if (assign.cutoffdate) {
                                if (assign.cutoffdate > time) {
                                    $scope.lateSubmissions = $translate.instant('mma.mod_assign.latesubmissionsaccepted', {
                                        '$a': moment(assign.cutoffdate * 1000).format($translate.instant('mm.core.dfmediumdate'))
                                    });
                                } else {
                                    $scope.lateSubmissions = $translate.instant('mma.mod_assign.nomoresubmissionsaccepted');
                                }
                            }
                        }
                    }

                    return $mmaModAssign.getSubmissionStatus(assign.id).then(function(response) {
                        $scope.summary = response.gradingsummary;

                        $scope.needsGradingAvalaible = response.gradingsummary.submissionsneedgradingcount > 0 &&
                            parseInt($mmSite.getInfo().version, 10) >= 2016110200;
                    }).catch(function() {
                        // Fail silently (WS is not available, fallback).
                        return $q.when();
                    });
                }
            });
        }).catch(function(message) {
            if (!refresh && !assign) {
                // Some call failed, retry without using cache since it might be a new activity.
                return refreshAllData(sync, showErrors);
            }

            if (message) {
                $mmUtil.showErrorModal(message);
            } else {
                $mmUtil.showErrorModal('Error getting assigment data.');
            }
            return $q.reject();
        });
    }

    // Convenience function to refresh all the data.
    function refreshAllData(sync, showErrors) {
        var promises = [$mmaModAssign.invalidateAssignmentData(courseId)];
        if ($scope.assign) {
            promises.push($mmaModAssign.invalidateAllSubmissionData($scope.assign.id));
            if ($scope.canviewsubmissions) {
                promises.push($mmaModAssign.invalidateSubmissionStatusData($scope.assign.id));
            }
        }
        fillContextMenu(module, courseId);
        return $q.all(promises).finally(function() {
            $scope.$broadcast(mmaModAssignSubmissionInvalidatedEvent);
            return fetchAssignment(true, sync, showErrors);
        });
    }

    fetchAssignment(false, true, false).then(function() {
        $mmaModAssign.logView($scope.assign.id).then(function() {
            $mmCourse.checkModuleCompletion(courseId, module.completionstatus);
        }).catch(function() {
            // Fail silently for Moodle < 3.2.
        });

        if (!$scope.canviewsubmissions) {
            $mmaModAssign.logSubmissionView($scope.assign.id).catch(function() {
                // Fail silently for Moodle < 3.1.
            });
        } else {
            $mmaModAssign.logGradingView($scope.assign.id).catch(function() {
                // Fail silently for Moodle < 3.0.
            });
        }
    }).finally(function() {
        $scope.assignmentLoaded = true;
        $scope.refreshIcon = 'ion-refresh';
        $scope.syncIcon = 'ion-loop';
    });

    // Convenience function that fills Context Menu Popover.
    function fillContextMenu(module, courseId, invalidateCache) {
        $mmCourseHelper.getModulePrefetchInfo(module, courseId, invalidateCache).then(function(moduleInfo) {
            $scope.size = moduleInfo.size > 0 ? moduleInfo.sizeReadable : 0;
            $scope.prefetchStatusIcon = moduleInfo.statusIcon;
            $scope.timemodified = moduleInfo.timemodified > 0 ? $translate.instant('mm.core.lastmodified') + ': ' + moduleInfo.timemodifiedReadable : "";
        });
    }

    $scope.removeFiles = function() {
        $mmUtil.showConfirm($translate('mm.course.confirmdeletemodulefiles')).then(function() {
            $mmCoursePrefetchDelegate.removeModuleFiles(module, courseId);
        });
    };

    // Context Menu Prefetch action.
    $scope.prefetch = function() {
        var icon = $scope.prefetchStatusIcon;

        $scope.prefetchStatusIcon = 'spinner'; // Show spinner since this operation might take a while.

        // We need to call getDownloadSize, the package might have been updated.
        $mmCoursePrefetchDelegate.getModuleDownloadSize(module, courseId).then(function(size) {
            $mmUtil.confirmDownloadSize(size).then(function() {
                $mmCoursePrefetchDelegate.prefetchModule(module, courseId).catch(function() {
                    if (!$scope.$$destroyed) {
                        $mmUtil.showErrorModal('mm.core.errordownloading', true);
                    }
                });
            }).catch(function() {
                // User hasn't confirmed, stop spinner.
                $scope.prefetchStatusIcon = icon;
            });
        }).catch(function(error) {
            $scope.prefetchStatusIcon = icon;
            if (error) {
                $mmUtil.showErrorModal(error);
            } else {
                $mmUtil.showErrorModal('mm.core.errordownloading', true);
            }
        });
    };

    // Context Menu Description action.
    $scope.expandDescription = function() {
        if ($scope.assign.id && ($scope.description || $scope.assign.introattachments)) {
            // Open a new state with the interpolated contents.
            $state.go('site.mod_assign-description', {
                moduleid: module.id,
                description: $scope.description,
                files: $scope.assign.introattachments
            });
        }
    };

    $scope.refreshAssignment = function(showErrors) {
        if ($scope.assignmentLoaded) {
            $scope.refreshIcon = 'spinner';
            $scope.syncIcon = 'spinner';
            return refreshAllData(true, showErrors).finally(function() {
                $scope.refreshIcon = 'ion-refresh';
                $scope.syncIcon = 'ion-loop';
                $scope.$broadcast('scroll.refreshComplete');

            });
        }
    };

    // Tries to synchronize the assign.
    function syncAssign(showErrors) {
        return $mmaModAssignSync.syncAssign($scope.assign.id).then(function(result) {
            if (result.warnings && result.warnings.length) {
                $mmUtil.showErrorModal($mmText.buildMessage(result.warnings));
            }

            if (result.updated) {
                // Sync done, trigger event.
                $mmEvents.trigger(mmaModAssignEventManualSynced, {
                    siteid: $mmSite.getId(),
                    assignid: $scope.assign.id,
                    warnings: result.warnings
                });
            }

            return result.updated;
        }).catch(function(error) {
            if (showErrors) {
                if (error) {
                    $mmUtil.showErrorModal(error);
                } else {
                    $mmUtil.showErrorModal('mm.core.errorsync', true);
                }
            }
            return $q.reject();
        });
    }

    // Show spinners and refresh the data.
    function showSpinnerAndRefresh(sync, showErrors) {
        $scope.refreshIcon = 'spinner';
        $scope.syncIcon = 'spinner';
        $scope.assignmentLoaded = false;
        scrollTop();

        refreshAllData(sync, showErrors).finally(function() {
            $scope.refreshIcon = 'ion-refresh';
            $scope.syncIcon = 'ion-loop';
            $scope.assignmentLoaded = true;
            fillContextMenu(module, courseId);
        });
    }

    // Scroll to top.
    function scrollTop() {
        if (!scrollView) {
            scrollView = $ionicScrollDelegate.$getByHandle('mmaModAssignIndexScroll');
        }
        scrollView && scrollView.scrollTop && scrollView.scrollTop();
    }

    // Listen for submission saved event to refresh data.
    obsSaved = $mmEvents.on(mmaModAssignSubmissionSavedEvent, function(data) {
        if ($scope.assign && data.assignmentId == $scope.assign.id && data.siteId == siteId && data.userId == userId) {
            // Assignment submission saved, refresh data.
            showSpinnerAndRefresh(true, false);
        }
    });

    // Listen for submitted for grading event to refresh data.
    obsSubmitted = $mmEvents.on(mmaModAssignSubmittedForGradingEvent, function(data) {
        if ($scope.assign && data.assignmentId == $scope.assign.id && data.siteId == siteId && data.userId == userId) {
            // Assignment submitted, check completion.
            $mmCourse.checkModuleCompletion(courseId, module.completionstatus);
        }
    });

    // Refresh data if this assign is synchronized automatically.
    syncObserver = $mmEvents.on(mmaModAssignEventAutomSynced, function(data) {
        if (data && $scope.assign && data.siteid == $mmSite.getId() && data.assignid == $scope.assign.id) {
            if (data.warnings && data.warnings.length) {
                // Show warnings.
                $mmUtil.showErrorModal($mmText.buildMessage(data.warnings));
            }

            showSpinnerAndRefresh(false, false);
        }
    });

    // Refresh online status when changes.
    onlineObserver = $mmEvents.on(mmCoreEventOnlineStatusChanged, function(online) {
        $scope.isOnline = online;
    });

    $scope.$on('$destroy', function() {
        obsSaved && obsSaved.off && obsSaved.off();
        obsSubmitted && obsSubmitted.off && obsSubmitted.off();
        syncObserver && syncObserver.off && syncObserver.off();
        onlineObserver && onlineObserver.off && onlineObserver.off();
    });
});
